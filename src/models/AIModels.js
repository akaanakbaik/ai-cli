const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const { getSystemPrompt } = require('../prompts/SystemPrompt');

class AIModel {
    constructor() {
        this.modelName = 'base';
        this.maxRetries = 2;
        this.timeout = 45000;
    }

    async chat(messages, options = {}) {
        throw new Error('Method chat harus diimplementasikan');
    }
}

class GeminiModel extends AIModel {
    constructor() {
        super();
        this.modelName = 'Gemini';
        this.baseURL = 'https://g4f.space/api/gemini-v1beta';
        this.fallbackURL = 'https://api.g4f.space/gemini';
        this.availableModels = [
            'gemini-flash-lite-latest',
            'gemini-flash-latest',
            'gemma-3-27b-it'
        ];
    }

    getRandomIP() {
        return [10, crypto.randomInt(256), crypto.randomInt(256), crypto.randomInt(256)].join('.');
    }

    async chat(messages, options = {}) {
        const model = options.model || this.availableModels[0];
        const ip = this.getRandomIP();
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const requestBody = {
                    messages: messages,
                    model: model,
                    temperature: options.temperature || 0.7,
                    max_tokens: options.maxTokens || 2048
                };
                
                const response = await axios.post(`${this.baseURL}/chat/completions`, requestBody, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Origin': 'https://g4f.dev',
                        'Referer': 'https://g4f.dev/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'x-forwarded-for': ip,
                        'x-real-ip': ip
                    },
                    timeout: this.timeout
                });

                if (response.data && response.data.choices && response.data.choices[0]) {
                    const content = response.data.choices[0].message?.content || response.data.choices[0].text;
                    if (content && content.length > 0) {
                        return {
                            success: true,
                            content: content,
                            model: model,
                            usage: response.data.usage || null
                        };
                    }
                }
                
                if (response.data && response.data.content) {
                    return {
                        success: true,
                        content: response.data.content,
                        model: model
                    };
                }
                
                throw new Error('Response kosong atau format tidak dikenal');

            } catch (error) {
                if (attempt === this.maxRetries) {
                    return {
                        success: false,
                        error: `Gemini API Error: ${error.message}`,
                        model: this.modelName,
                        attempt: attempt
                    };
                }
                await new Promise(r => setTimeout(r, 1500 * attempt));
            }
        }
        return {
            success: false,
            error: 'Max retries exceeded',
            model: this.modelName
        };
    }

    async chatWithMode(messages, mode = 'normal', options = {}) {
        const systemPrompt = getSystemPrompt(mode);
        const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
        return this.chat(fullMessages, options);
    }
}

class CopilotModel extends AIModel {
    constructor() {
        super();
        this.modelName = 'Copilot';
        this.conversationId = null;
        this.cookieJar = null;
        this.modes = {
            'normal': 'balanced',
            'technical': 'precise',
            'creative': 'creative',
            'educational': 'balanced',
            'business': 'precise'
        };
    }

    async createConversation() {
        try {
            const response = await axios.post('https://copilot.microsoft.com/c/api/conversations', null, {
                headers: {
                    'Origin': 'https://copilot.microsoft.com',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://copilot.microsoft.com/',
                    'Accept': 'application/json'
                },
                timeout: 10000
            });
            
            if (response.data && response.data.id) {
                this.conversationId = response.data.id;
                if (response.headers['set-cookie']) {
                    this.cookieJar = response.headers['set-cookie'].join('; ');
                }
                return this.conversationId;
            }
            throw new Error('Gagal mendapatkan conversation ID');
        } catch (error) {
            throw new Error(`Create conversation failed: ${error.message}`);
        }
    }

    async chat(messages, options = {}) {
        try {
            if (!this.conversationId) {
                await this.createConversation();
            }

            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            if (!lastUserMessage || !lastUserMessage.content) {
                return { success: false, error: 'Tidak ada pesan user yang valid' };
            }

            const mode = options.mode || 'normal';
            const selectedMode = this.modes[mode] || 'balanced';

            return new Promise((resolve) => {
                let response = '';
                let isDone = false;
                let timeoutId = setTimeout(() => {
                    if (!isDone) {
                        isDone = true;
                        resolve({
                            success: response.length > 0,
                            content: response || 'Maaf, terjadi timeout. Silakan coba lagi.',
                            model: this.modelName,
                            partial: response.length > 0
                        });
                    }
                }, this.timeout);

                const ws = new WebSocket('wss://copilot.microsoft.com/c/api/chat?api-version=2', {
                    headers: {
                        'Origin': 'https://copilot.microsoft.com',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: this.timeout
                });

                ws.on('open', () => {
                    try {
                        ws.send(JSON.stringify({
                            event: 'setOptions',
                            supportedFeatures: ['partial-generated-images']
                        }));

                        ws.send(JSON.stringify({
                            event: 'send',
                            mode: selectedMode,
                            conversationId: this.conversationId,
                            content: [{ type: 'text', text: lastUserMessage.content }],
                            context: {}
                        }));
                    } catch (err) {
                        clearTimeout(timeoutId);
                        isDone = true;
                        resolve({ success: false, error: `WebSocket send error: ${err.message}` });
                        ws.close();
                    }
                });

                ws.on('message', (chunk) => {
                    try {
                        const parsed = JSON.parse(chunk.toString());
                        
                        if (parsed.event === 'appendText' && parsed.text) {
                            response += parsed.text;
                        } else if (parsed.event === 'message' && parsed.content) {
                            const textContent = parsed.content.find(c => c.type === 'text');
                            if (textContent && textContent.text) {
                                response += textContent.text;
                            }
                        } else if (parsed.event === 'done') {
                            clearTimeout(timeoutId);
                            isDone = true;
                            ws.close();
                            resolve({
                                success: response.length > 0,
                                content: response || 'Tidak ada respons dari Copilot.',
                                model: this.modelName,
                                conversationId: this.conversationId
                            });
                        } else if (parsed.event === 'error') {
                            clearTimeout(timeoutId);
                            isDone = true;
                            ws.close();
                            resolve({
                                success: false,
                                error: parsed.message || 'Copilot error',
                                model: this.modelName
                            });
                        }
                    } catch (err) {
                        if (chunk && chunk.toString().length > 0) {
                            const text = chunk.toString();
                            if (text.includes('appendText') && text.includes('text')) {
                                try {
                                    const match = text.match(/\"text\":\"([^\"]+)\"/);
                                    if (match && match[1]) {
                                        response += match[1];
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                });

                ws.on('error', (error) => {
                    if (!isDone) {
                        clearTimeout(timeoutId);
                        isDone = true;
                        resolve({
                            success: response.length > 0,
                            content: response || `WebSocket error: ${error.message}`,
                            model: this.modelName,
                            error: error.message
                        });
                    }
                });

                ws.on('close', () => {
                    if (!isDone) {
                        clearTimeout(timeoutId);
                        isDone = true;
                        resolve({
                            success: response.length > 0,
                            content: response || 'Koneksi ditutup. Silakan coba lagi.',
                            model: this.modelName
                        });
                    }
                });
            });
        } catch (error) {
            return {
                success: false,
                error: `Copilot error: ${error.message}`,
                model: this.modelName
            };
        }
    }

    async chatWithMode(messages, mode = 'normal', options = {}) {
        const systemPrompt = getSystemPrompt(mode);
        const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
        return this.chat(fullMessages, { ...options, mode });
    }
}

class ZAIModel extends AIModel {
    constructor() {
        super();
        this.modelName = 'Z.ai';
        this.url = 'https://chat.z.ai';
        this.apiEndpoint = 'https://chat.z.ai/api/v2/chat/completions';
        this.apiKey = null;
        this.authUserId = null;
        this.availableModels = {
            'glm-4.6': 'GLM-4-6-API-V1',
            'glm-4.5': '0727-360B-API',
            'chatglm': 'glm-4-flash'
        };
    }

    async authenticate() {
        if (this.apiKey && this.authUserId) return true;
        
        try {
            const response = await axios.get(`${this.url}/api/v1/auths/`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });
            
            if (response.data && response.data.token && response.data.id) {
                this.apiKey = response.data.token;
                this.authUserId = response.data.id;
                return true;
            }
            throw new Error('Auth response invalid');
        } catch (error) {
            throw new Error(`Auth gagal: ${error.message}`);
        }
    }

    createSignature(sortedPayload, userPrompt) {
        const currentTime = Date.now();
        const dataString = `${sortedPayload}|${Buffer.from(userPrompt).toString('base64')}|${currentTime}`;
        const timeWindow = Math.floor(currentTime / (5 * 60 * 1000));
        const baseSignature = crypto.createHmac('sha256', 'key-@@@@)))()((9))-xxxx&&&%%%%%')
            .update(String(timeWindow)).digest('hex');
        const signature = crypto.createHmac('sha256', baseSignature)
            .update(dataString).digest('hex');
        return { signature, timestamp: currentTime };
    }

    async chat(messages, options = {}) {
        try {
            await this.authenticate();

            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            const userPrompt = lastUserMessage?.content || '';
            
            if (!userPrompt) {
                return { success: false, error: 'Tidak ada pesan user' };
            }
            
            const modelKey = options.model || 'glm-4.6';
            const modelId = this.availableModels[modelKey] || this.availableModels['glm-4.6'];

            const basicParams = {
                timestamp: String(Date.now()),
                requestId: crypto.randomUUID(),
                user_id: this.authUserId,
            };

            const sortedPayload = Object.keys(basicParams).sort()
                .map(k => `${k},${basicParams[k]}`).join(',');
            const { signature, timestamp } = this.createSignature(sortedPayload, userPrompt);

            const urlParams = new URLSearchParams({
                ...basicParams,
                version: '0.0.1',
                platform: 'web',
                token: this.apiKey,
                is_mobile: 'false',
                language: 'id-ID'
            }).toString();

            const endpoint = `${this.apiEndpoint}?${urlParams}&signature_timestamp=${timestamp}`;

            const requestBody = {
                stream: false,
                model: modelId,
                messages: messages,
                signature_prompt: userPrompt,
                features: {
                    image_generation: false,
                    web_search: options.search || false,
                    preview_mode: true,
                    enable_thinking: false
                },
                chat_id: crypto.randomUUID(),
                id: crypto.randomUUID()
            };

            const response = await axios.post(endpoint, requestBody, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'X-Signature': signature,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: this.timeout
            });

            let content = null;
            
            if (response.data && response.data.choices && response.data.choices[0]) {
                content = response.data.choices[0].message?.content;
            }
            
            if (response.data && response.data.content) {
                content = response.data.content;
            }
            
            if (response.data && response.data.result) {
                content = response.data.result;
            }
            
            if (content && content.length > 0) {
                return {
                    success: true,
                    content: content,
                    model: `${this.modelName} (${modelKey})`,
                    usage: response.data?.usage
                };
            }

            return {
                success: false,
                error: 'Response kosong dari Z.ai',
                model: this.modelName
            };

        } catch (error) {
            return {
                success: false,
                error: `Z.ai error: ${error.message}`,
                model: this.modelName
            };
        }
    }

    async chatWithMode(messages, mode = 'normal', options = {}) {
        const systemPrompt = getSystemPrompt(mode);
        const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
        return this.chat(fullMessages, options);
    }
}

class RandomModel extends AIModel {
    constructor() {
        super();
        this.modelName = 'Random';
        this.models = [
            new GeminiModel(),
            new CopilotModel(),
            new ZAIModel()
        ];
        this.currentModel = null;
        this.currentModelIndex = -1;
        this.currentMode = 'normal';
    }

    selectRandom() {
        const randomIndex = Math.floor(Math.random() * this.models.length);
        this.currentModelIndex = randomIndex;
        this.currentModel = this.models[randomIndex];
        return this.currentModel.modelName;
    }

    getCurrentModelName() {
        return this.currentModel ? this.currentModel.modelName : 'Belum dipilih';
    }

    setMode(mode) {
        this.currentMode = mode;
    }

    async chat(messages, options = {}) {
        if (!this.currentModel) {
            this.selectRandom();
        }
        
        const systemPrompt = getSystemPrompt(this.currentMode);
        const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
        
        try {
            const result = await this.currentModel.chat(fullMessages, options);
            return result;
        } catch (error) {
            const fallbackIndex = (this.currentModelIndex + 1) % this.models.length;
            this.currentModel = this.models[fallbackIndex];
            this.currentModelIndex = fallbackIndex;
            
            const fallbackResult = await this.currentModel.chat(fullMessages, options);
            return fallbackResult;
        }
    }
}

module.exports = {
    AIModel,
    GeminiModel,
    CopilotModel,
    ZAIModel,
    RandomModel
};