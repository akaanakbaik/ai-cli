const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class CDNManager {
    constructor() {
        this.uploadEndpoint = 'https://api.kabox.my.id/api/upload';
        this.cache = new Map();
        this.uploadQueue = [];
        this.isProcessing = false;
    }

    async uploadFile(filePath, options = {}) {
        try {
            const stats = await fs.stat(filePath);
            const fileStream = await fs.open(filePath, 'r');
            
            const form = new FormData();
            form.append('file', require('fs').createReadStream(filePath));
            
            const expire = options.expire || '1d';
            
            const response = await axios.post(this.uploadEndpoint, form, {
                headers: {
                    ...form.getHeaders(),
                    'x-expire': expire
                },
                timeout: 30000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            
            const result = {
                success: true,
                url: response.data.url,
                metadata: {
                    original_name: response.data.metadata.original_name,
                    size_formatted: response.data.metadata.size_formatted,
                    uploaded_at: new Date().toISOString(),
                    expires: expire
                }
            };
            
            this.cache.set(result.url, {
                ...result,
                cachedAt: Date.now()
            });
            
            await fileStream.close();
            
            return result;
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                original_path: filePath
            };
        }
    }

    async uploadBuffer(buffer, filename, options = {}) {
        const tempPath = path.join(require('os').tmpdir(), `cdn_upload_${Date.now()}_${filename}`);
        
        try {
            await fs.writeFile(tempPath, buffer);
            const result = await this.uploadFile(tempPath, options);
            await fs.unlink(tempPath);
            return result;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async uploadFromUrl(url, options = {}) {
        try {
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            const contentType = response.headers['content-type'];
            const extension = contentType?.split('/')[1] || 'jpg';
            const filename = `media_${Date.now()}.${extension}`;
            
            const result = await this.uploadBuffer(response.data, filename, options);
            
            return result;
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                source_url: url
            };
        }
    }

    async uploadGeneratedImage(base64Data, options = {}) {
        const buffer = Buffer.from(base64Data.split(',')[1] || base64Data, 'base64');
        const filename = `generated_${Date.now()}.png`;
        
        return await this.uploadBuffer(buffer, filename, options);
    }

    async batchUpload(files, options = {}) {
        const results = [];
        
        for (const file of files) {
            let result;
            if (typeof file === 'string') {
                if (file.startsWith('http')) {
                    result = await this.uploadFromUrl(file, options);
                } else {
                    result = await this.uploadFile(file, options);
                }
            } else if (file.buffer) {
                result = await this.uploadBuffer(file.buffer, file.filename, options);
            } else {
                result = { success: false, error: 'Format file tidak dikenali' };
            }
            
            results.push(result);
            
            if (results.length < files.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        return results;
    }

    async queueUpload(file, options = {}) {
        return new Promise((resolve, reject) => {
            this.uploadQueue.push({
                file,
                options,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing) return;
        if (this.uploadQueue.length === 0) return;
        
        this.isProcessing = true;
        
        while (this.uploadQueue.length > 0) {
            const task = this.uploadQueue.shift();
            
            try {
                let result;
                if (typeof task.file === 'string') {
                    if (task.file.startsWith('http')) {
                        result = await this.uploadFromUrl(task.file, task.options);
                    } else {
                        result = await this.uploadFile(task.file, task.options);
                    }
                } else if (task.file.buffer) {
                    result = await this.uploadBuffer(task.file.buffer, task.file.filename, task.options);
                } else {
                    result = { success: false, error: 'Format tidak dikenali' };
                }
                
                task.resolve(result);
                
            } catch (error) {
                task.reject(error);
            }
            
            await new Promise(r => setTimeout(r, 200));
        }
        
        this.isProcessing = false;
    }

    getCachedUrls() {
        return Array.from(this.cache.keys());
    }

    clearCache(olderThan = null) {
        if (olderThan) {
            for (const [url, data] of this.cache.entries()) {
                if (data.cachedAt < olderThan) {
                    this.cache.delete(url);
                }
            }
        } else {
            this.cache.clear();
        }
    }

    async deleteFromCdn(url) {
        try {
            await axios.delete(url);
            this.cache.delete(url);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    extractMediaFromText(text) {
        const patterns = {
            image: /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg))/gi,
            video: /(https?:\/\/[^\s]+\.(mp4|webm|avi|mov|mkv))/gi,
            audio: /(https?:\/\/[^\s]+\.(mp3|wav|ogg|m4a|flac))/gi,
            document: /(https?:\/\/[^\s]+\.(pdf|doc|docx|xls|xlsx|ppt|pptx))/gi,
            archive: /(https?:\/\/[^\s]+\.(zip|rar|7z|tar|gz))/gi
        };
        
        const media = [];
        
        for (const [type, regex] of Object.entries(patterns)) {
            const matches = text.match(regex);
            if (matches) {
                for (const url of matches) {
                    media.push({ type, url });
                }
            }
        }
        
        return [...new Map(media.map(m => [m.url, m])).values()];
    }

    async autoUploadMediaInText(text, options = {}) {
        const mediaList = this.extractMediaFromText(text);
        
        if (mediaList.length === 0) {
            return { text, uploaded: [] };
        }
        
        const uploadResults = [];
        let modifiedText = text;
        
        for (const media of mediaList) {
            const result = await this.uploadFromUrl(media.url, options);
            
            if (result.success) {
                uploadResults.push({
                    original: media.url,
                    cdn: result.url,
                    type: media.type
                });
                
                modifiedText = modifiedText.replace(media.url, `${result.url}\n[CDN UPLOADED: ${media.type}]`);
            } else {
                uploadResults.push({
                    original: media.url,
                    error: result.error,
                    type: media.type
                });
            }
            
            await new Promise(r => setTimeout(r, 300));
        }
        
        return {
            text: modifiedText,
            uploaded: uploadResults,
            mediaCount: uploadResults.length
        };
    }
}

module.exports = CDNManager;
