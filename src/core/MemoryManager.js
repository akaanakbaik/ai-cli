const crypto = require('crypto');
const axios = require('axios');

class MemoryManager {
    constructor() {
        this.shortTerm = [];
        this.longTerm = [];
        this.summary = '';
        this.sessionId = crypto.randomBytes(16).toString('hex');
        this.maxShortTerm = 15;
        this.summarizerEndpoint = 'https://g4f.space/api/gemini-v1beta';
        this.lastCompress = Date.now();
        this.compressInterval = 60000;
        this.memoryStats = {
            totalMessages: 0,
            compressions: 0,
            tokensSaved: 0
        };
    }

    add(role, content, metadata = {}) {
        const message = {
            id: crypto.randomBytes(8).toString('hex'),
            role,
            content,
            metadata,
            timestamp: Date.now()
        };
        
        this.shortTerm.push(message);
        this.memoryStats.totalMessages++;
        
        if (this.shortTerm.length >= this.maxShortTerm) {
            this.compress();
        }
        
        if (Date.now() - this.lastCompress >= this.compressInterval) {
            this.compress();
            this.lastCompress = Date.now();
        }
        
        return message.id;
    }

    async compress() {
        if (this.shortTerm.length === 0) return;
        
        const conversationText = this.shortTerm.map(msg => {
            let text = `${msg.role}: ${msg.content.substring(0, 200)}`;
            if (msg.metadata.media) text += ` [MEDIA: ${msg.metadata.media}]`;
            if (msg.metadata.code) text += ` [CODE: ${msg.metadata.code.length} chars]`;
            return text;
        }).join('\n');
        
        const compressionRatio = 1 - (conversationText.length / this.shortTerm.reduce((sum, m) => sum + m.content.length, 0));
        this.memoryStats.tokensSaved += Math.floor(conversationText.length * compressionRatio);
        
        try {
            const summary = await this.callSummarizer(conversationText);
            
            this.longTerm.push({
                summary,
                messageIds: this.shortTerm.map(m => m.id),
                timestamp: Date.now(),
                messageCount: this.shortTerm.length
            });
            
            if (this.longTerm.length > 10) {
                this.longTerm.shift();
            }
            
            this.summary = this.longTerm.slice(-5).map(l => l.summary).join(' ');
            
            this.shortTerm = [];
            this.memoryStats.compressions++;
            
        } catch (error) {
            const fallbackSummary = conversationText.substring(0, 500);
            this.longTerm.push({
                summary: fallbackSummary,
                messageIds: this.shortTerm.map(m => m.id),
                timestamp: Date.now(),
                messageCount: this.shortTerm.length
            });
            
            this.summary = fallbackSummary;
            this.shortTerm = [];
            this.memoryStats.compressions++;
        }
    }

    async callSummarizer(text) {
        const ip = [10, crypto.randomInt(256), crypto.randomInt(256), crypto.randomInt(256)].join('.');
        
        const systemPrompt = `Kamu adalah sistem peringkas percakapan super canggih. Tugasmu:
1. Ringkas percakapan dengan sangat jelas dan terstruktur
2. Ambil poin-poin penting, keputusan, dan kesimpulan
3. Catat informasi personal user (nama, preferensi, dll)
4. Catat task yang sudah/perlu dilakukan
5. Catat kode atau script yang dibuat
6. Maksimal 300 kata, padat dan informatif
7. Gunakan format bullet points untuk poin penting`;

        try {
            const response = await axios.post(`${this.summarizerEndpoint}/chat/completions`, {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Ringkaskan percakapan ini:\n\n${text}` }
                ],
                model: 'models/gemini-flash-lite-latest'
            }, {
                headers: {
                    'x-forwarded-for': ip,
                    'x-real-ip': ip,
                    'client-ip': ip
                },
                timeout: 15000
            });
            
            return response.data.choices?.[0]?.message?.content || text.substring(0, 300);
            
        } catch (error) {
            throw new Error('Summarizer failed');
        }
    }

    getContext(limit = 5000) {
        let context = '';
        
        if (this.summary && this.summary.length > 0) {
            context += `=== RINGKASAN PERCAKAPAN SEBELUMNYA ===\n${this.summary}\n\n`;
        }
        
        if (this.longTerm.length > 0 && !this.summary) {
            const recentLong = this.longTerm.slice(-3);
            context += `=== HISTORI PERCAKAPAN ===\n`;
            for (const long of recentLong) {
                context += `${long.summary}\n---\n`;
            }
            context += '\n';
        }
        
        if (this.shortTerm.length > 0) {
            context += `=== PERCAKAPAN TERBARU ===\n`;
            for (const msg of this.shortTerm.slice(-8)) {
                context += `[${msg.role.toUpperCase()}]: ${msg.content.substring(0, 300)}`;
                if (msg.metadata.media) context += `\n[Media: ${msg.metadata.media}]`;
                if (msg.metadata.code) context += `\n[Code: ${msg.metadata.code.substring(0, 100)}...]`;
                context += `\n\n`;
            }
        }
        
        if (context.length > limit) {
            context = context.substring(0, limit) + '\n...[TRUNCATED]...';
        }
        
        return context || 'Percakapan baru dimulai. Tidak ada konteks sebelumnya.';
    }

    getShortContext() {
        let context = '';
        
        if (this.summary) {
            context = `[Context: ${this.summary.substring(0, 300)}]`;
        }
        
        const lastMessages = this.shortTerm.slice(-4);
        if (lastMessages.length > 0) {
            const lastText = lastMessages.map(m => `${m.role}: ${m.content.substring(0, 100)}`).join(' | ');
            context += ` [Recent: ${lastText}]`;
        }
        
        return context || '';
    }

    getImportantInfo() {
        const important = {
            userInfo: {},
            tasks: [],
            codeSnippets: [],
            decisions: []
        };
        
        const allMessages = [...this.longTerm.flatMap(l => l.summary.split(' ')), ...this.shortTerm.map(m => m.content)];
        const fullText = allMessages.join(' ');
        
        const nameMatch = fullText.match(/nama(?:ku| saya| user) (?:adalah|:?\s+)([A-Z][a-z]+)/i);
        if (nameMatch) important.userInfo.name = nameMatch[1];
        
        const emailMatch = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) important.userInfo.email = emailMatch[0];
        
        const taskMatches = fullText.match(/(?:buat|buatkan|tolong|bantu) (?:saya )?(?:buat|buatkan|bikin|kerjakan) ([^.!?]+)/gi);
        if (taskMatches) {
            important.tasks = taskMatches.slice(0, 5).map(t => t.substring(0, 100));
        }
        
        const codeMatches = fullText.match(/```(\w+)?\n([\s\S]+?)\n```/g);
        if (codeMatches) {
            important.codeSnippets = codeMatches.slice(0, 3);
        }
        
        return important;
    }

    clear() {
        this.shortTerm = [];
        this.longTerm = [];
        this.summary = '';
        this.memoryStats = {
            totalMessages: 0,
            compressions: 0,
            tokensSaved: 0
        };
        this.lastCompress = Date.now();
    }

    getStats() {
        return {
            sessionId: this.sessionId,
            shortTermCount: this.shortTerm.length,
            longTermCount: this.longTerm.length,
            totalMessages: this.memoryStats.totalMessages,
            compressions: this.memoryStats.compressions,
            tokensSaved: this.memoryStats.tokensSaved,
            summaryLength: this.summary.length,
            age: Date.now() - this.lastCompress
        };
    }

    exportMemory() {
        return {
            sessionId: this.sessionId,
            shortTerm: this.shortTerm,
            longTerm: this.longTerm,
            summary: this.summary,
            stats: this.memoryStats,
            exportedAt: Date.now()
        };
    }

    importMemory(data) {
        this.sessionId = data.sessionId;
        this.shortTerm = data.shortTerm;
        this.longTerm = data.longTerm;
        this.summary = data.summary;
        this.memoryStats = data.stats;
        this.lastCompress = Date.now();
    }
}

module.exports = MemoryManager;