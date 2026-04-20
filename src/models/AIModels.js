const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const { getSystemPrompt, MODES } = require('../prompts/SystemPrompt');

class AIModel {
    constructor() {
        this.modelName = 'base';
        this.maxRetries = 3;
        this.timeout = 60000;
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
        this.availableModels = [
            'models/gemini-flash-lite-latest',
            'models/gemini-flash-latest',
            'models/gemma-3-27b-it',
            'models/gemma-2-27b-it'
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
                const response = await axios.post(`${this.baseURL}/chat/completions`, {
                    messages: messages,
                    model: model,
                    temperature: options.temperature || 0.7,
                    max_tokens: options.maxTokens || 4096,
                    stream: false
                }, {
                    headers: {
                        'origin': 'https://g4f.dev',
                        'referer': 'https://g4f.dev/',
                        'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36',
                        'x-forwarded-for': ip,
                        'x-real-ip': ip,
                        'client-ip': ip,
                        'x-remote-ip': ip
                    },
                    timeout: this.timeout
                });

                if (response.data?.choices?.[0]?.message?.content) {
                    return {
                        success: true,
                        content: response.data.choices[0].message.content,
                        model: model,
                        usage: response.data.usage || null
                    };
                }

                throw new Error('Response tidak valid');

            } catch (error) {
                if (attempt === this.maxRetries) {
                    return {
                        success: false,
                        error: error.message,
                        model: this.modelName
                    };
                }
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }

    async chatWithMode(messages, mode = 'normal', options = {}) {
        const systemPrompt = getSystemPrompt(mode);
        const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
        return this.chat(fullMessages, options);
    }

    async streamChat(messages, onChunk, options = {}) {
        const model = options.model || this.availableModels[0];
        const ip = this.getRandomIP();
        
        try {
            const response = await axios.post(`${this.baseURL}/chat/completions`, {
                messages: messages,
                model: model,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 4096,
                stream: true
            }, {
                headers: {
                    'origin': 'https://g4f.dev',
                    'referer': 'https://g4f.dev/',
                    'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36',
                    'x-forwarded-for': ip,
                    'x-real-ip': ip,
                    'client-ip': ip
                },
                responseType: 'stream',
                timeout: this.timeout
            });

            let fullContent = '';
            
            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices?.[0]?.delta?.content) {
                                const content = data.choices[0].delta.content;
                                fullContent += content;
                                if (onChunk) onChunk(content);
                            }
                        } catch (e) {}
                    }
                }
            });

            return new Promise((resolve) => {
                response.data.on('end', () => {
                    resolve({
                        success: true,
                        content: fullContent,
                        model: model
                    });
                });
                
                response.data.on('error', (error) => {
                    resolve({
                        success: false,
                        error: error.message,
                        model: this.modelName
                    });
                });
            });

        } catch (error) {
            return {
                success: false,
                error: error.message,
                model: this.modelName
            };
        }
    }
}

class CopilotModel extends AIModel {
    constructor() {
        super();
        this.modelName = 'Copilot';
        this.conversationId = null;
        this.modes = {
            'balanced': 'chat',
            'creative': 'creative',
            'precise': 'precise'
        };
    }

    async createConversation() {
        try {
            const response = await axios.post('https://copilot.microsoft.com/c/api/conversations', null, {
                headers: {
                    'origin': 'https://copilot.microsoft.com',
                    'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36',
                    'referer': 'https://copilot.microsoft.com/'
                }
            });
            this.conversationId = response.data.id;
            return this.conversationId;
        } catch (error) {
            throw new Error(`Gagal membuat conversation: ${error.message}`);
        }
    }

    async chat(messages, options = {}) {
        if (!this.conversationId) {
            await this.createConversation();
        }

        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        if (!lastUserMessage) {
            return { success: false, error: 'Tidak ada pesan user' };
        }

        const mode = options.mode || 'balanced';
        const selectedMode = this.modes[mode] || this.modes.balanced;

        return new Promise((resolve) => {
            const ws = new WebSocket(`wss://copilot.microsoft.com/c/api/chat?api-version=2`, {
                headers: {
                    'origin': 'https://copilot.microsoft.com',
                    'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36'
                }
            });

            let response = '';
            let timeout = setTimeout(() => {
                ws.close();
                resolve({
                    success: false,
                    error: 'Timeout',
                    model: this.modelName
                });
            }, this.timeout);

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    event: 'setOptions',
                    supportedFeatures: ['partial-generated-images'],
                    supportedCards: ['weather', 'local', 'image', 'video']
                }));

                ws.send(JSON.stringify({
                    event: 'send',
                    mode: selectedMode,
                    conversationId: this.conversationId,
                    content: [{ type: 'text', text: lastUserMessage.content }],
                    context: {}
                }));
            });

            ws.on('message', (chunk) => {
                try {
                    const parsed = JSON.parse(chunk.toString());
                    if (parsed.event === 'appendText') {
                        response += parsed.text || '';
                    } else if (parsed.event === 'done') {
                        clearTimeout(timeout);
                        ws.close();
                        resolve({
                            success: true,
                            content: response,
                            model: this.modelName,
                            conversationId: this.conversationId
                        });
                    } else if (parsed.event === 'error') {
                        clearTimeout(timeout);
                        ws.close();
                        resolve({
                            success: false,
                            error: parsed.message,
                            model: this.modelName
                        });
                    }
                } catch (e) {}
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    error: error.message,
                    model: this.modelName
                });
            });
        });
    }

    async chatWithMode(messages, mode = 'normal', options = {}) {
        const systemPrompt = getSystemPrompt(mode);
        const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
        return this.chat(fullMessages, options);
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
            'glm-4.5-air': '0727-106B-API',
            'z1-32b': 'zero',
            'chatglm': 'glm-4-flash'
        };
    }

    async authenticate() {
        if (this.apiKey && this.authUserId) return true;
        
        try {
            const response = await axios.get(`${this.url}/api/v1/auths/`, {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36'
                }
            });
            this.apiKey = response.data.token;
            this.authUserId = response.data.id;
            return true;
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
        await this.authenticate();

        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        const userPrompt = lastUserMessage?.content || '';
        
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
            is_mobile: 'true',
            language: 'en-US'
        }).toString();

        const endpoint = `${this.apiEndpoint}?${urlParams}&signature_timestamp=${timestamp}`;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await axios.post(endpoint, {
                    stream: false,
                    model: modelId,
                    messages: messages,
                    signature_prompt: userPrompt,
                    features: {
                        image_generation: false,
                        web_search: options.search || false,
                        preview_mode: true,
                        enable_thinking: options.reasoning || false
                    },
                    chat_id: crypto.randomUUID(),
                    id: crypto.randomUUID()
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'X-Signature': signature,
                        'Content-Type': 'application/json',
                        'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36'
                    },
                    timeout: this.timeout
                });

                const content = response.data?.choices?.[0]?.message?.content;
                if (content) {
                    return {
                        success: true,
                        content: content,
                        model: `${this.modelName} (${modelKey})`,
                        usage: response.data?.usage
                    };
                }

                throw new Error('Response kosong');

            } catch (error) {
                if (attempt === this.maxRetries) {
                    return {
                        success: false,
                        error: error.message,
                        model: this.modelName
                    };
                }
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
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
        
        if (this.currentModel.chatWithMode) {
            return await this.currentModel.chatWithMode(messages, this.currentMode, options);
        }
        
        return await this.currentModel.chat(fullMessages, options);
    }

    async streamChat(messages, onChunk, options = {}) {
        if (!this.currentModel) {
            this.selectRandom();
        }
        
        const systemPrompt = getSystemPrompt(this.currentMode);
        const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
        
        if (this.currentModel.streamChat) {
            return await this.currentModel.streamChat(fullMessages, onChunk, options);
        }
        
        const result = await this.currentModel.chat(fullMessages, options);
        if (result.success && onChunk) {
            onChunk(result.content);
        }
        return result;
    }
}

module.exports = {
    AIModel,
    GeminiModel,
    CopilotModel,
    ZAIModel,
    RandomModel
};
