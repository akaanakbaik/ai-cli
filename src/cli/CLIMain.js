const readline = require('readline');
const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const SandboxManager = require('../core/SandboxManager');
const CDNManager = require('../core/CDNManager');
const MemoryManager = require('../core/MemoryManager');
const { GeminiModel, CopilotModel, ZAIModel, RandomModel } = require('../models/AIModels');
const { getSystemPrompt, MODES } = require('../prompts/SystemPrompt');

class CLIMain {
    constructor() {
        this.rl = null;
        this.sandboxManager = new SandboxManager();
        this.cdnManager = new CDNManager();
        this.memoryManager = new MemoryManager();
        this.currentModel = null;
        this.currentModelType = null;
        this.isRandomMode = false;
        this.sessionActive = true;
        this.pendingSandboxRequest = null;
        this.typingSpeed = 25;
        this.currentMode = 'normal';
        this.availableModes = MODES;
        this.loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.colors = {
            primary: '#00ff88',
            secondary: '#ff00ff',
            accent: '#ff8800',
            error: '#ff4444',
            success: '#44ff44',
            info: '#44aaff'
        };
    }

    async init() {
        console.log(chalk.hex(this.colors.primary)(`
╔══════════════════════════════════════════════════════════════╗
║     🤖 MEGAVERSE CLI - AI CHAT ULTIMATE                     ║
║     Versi: 2.0.0 | Multi Mode System Prompt                ║
╚══════════════════════════════════════════════════════════════╝
        `));

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.hex(this.colors.secondary)('\n💬 Anda: ')
        });

        this.rl.on('line', this.handleInput.bind(this));
        this.rl.on('close', () => {
            console.log(chalk.hex(this.colors.info)('\n👋 Sampai jumpa!\n'));
            process.exit(0);
        });

        await this.showMenu();
    }

    async typingAnimation(text, delay = this.typingSpeed) {
        return new Promise((resolve) => {
            let i = 0;
            const interval = setInterval(() => {
                if (i < text.length) {
                    process.stdout.write(text[i]);
                    i++;
                } else {
                    clearInterval(interval);
                    console.log('');
                    resolve();
                }
            }, delay);
        });
    }

    async loadingAnimation(message, duration = 1500) {
        let i = 0;
        const startTime = Date.now();
        
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                process.stdout.write(`\r${this.loadingFrames[i]} ${message}`);
                i = (i + 1) % this.loadingFrames.length;
            }, 80);
            
            setTimeout(() => {
                clearInterval(interval);
                process.stdout.write(`\r✓ ${message} selesai!   \n`);
                resolve();
            }, duration);
        });
    }

    async showMenu() {
        console.log(chalk.hex(this.colors.accent)(`
╔════════════════════════════════════════════════╗
║                PILIH MODEL AI                 ║
╠════════════════════════════════════════════════╣
║  ${chalk.hex(this.colors.primary)('1')}. Gemini (Google)                          ║
║  ${chalk.hex(this.colors.primary)('2')}. Copilot (Microsoft)                     ║
║  ${chalk.hex(this.colors.primary)('3')}. Z.ai (GLM-4.6)                          ║
║  ${chalk.hex(this.colors.secondary)('4')}. 🎲 RANDOM (pilih acak, tetap 1 sesi)    ║
║  ${chalk.hex(this.colors.accent)('5')}. 📤 Upload File ke CDN                     ║
║  ${chalk.hex(this.colors.error)('0')}. Exit                                      ║
╚════════════════════════════════════════════════╝
        `));

        this.rl.question(chalk.hex(this.colors.info)('Pilih (1/2/3/4/5/0): '), async (choice) => {
            await this.handleMenuChoice(choice.trim());
        });
    }

    async handleMenuChoice(choice) {
        switch(choice) {
            case '0':
                this.rl.close();
                break;
            case '1':
                await this.initModel(new GeminiModel(), 'Gemini');
                break;
            case '2':
                await this.initModel(new CopilotModel(), 'Copilot');
                break;
            case '3':
                await this.initModel(new ZAIModel(), 'Z.ai');
                break;
            case '4':
                await this.initRandomModel();
                break;
            case '5':
                await this.handleUpload();
                break;
            default:
                console.log(chalk.hex(this.colors.error)('❌ Pilihan tidak valid!'));
                await this.showMenu();
                break;
        }
    }

    async showModeMenu() {
        console.log(chalk.hex(this.colors.accent)(`
╔════════════════════════════════════════════════╗
║              PILIH MODE AI                     ║
╠════════════════════════════════════════════════╣
        `));
        
        for (const mode of this.availableModes) {
            console.log(chalk.hex(this.colors.primary)(`  ${mode.id}. ${mode.name} - ${mode.description}`));
        }
        
        console.log(chalk.hex(this.colors.accent)(`
╚════════════════════════════════════════════════╝
        `));
        
        this.rl.question(chalk.hex(this.colors.info)('Pilih mode (1/2/3/4/5): '), async (choice) => {
            const selected = this.availableModes.find(m => m.id === choice);
            if (selected) {
                this.currentMode = selected.value;
                if (this.currentModel && this.currentModel.setMode) {
                    this.currentModel.setMode(this.currentMode);
                }
                console.log(chalk.hex(this.colors.success)(`\n✅ Mode ${selected.name} aktif!\n`));
            } else {
                console.log(chalk.hex(this.colors.error)('\n❌ Mode tidak valid, menggunakan mode Normal.\n'));
                this.currentMode = 'normal';
            }
            
            if (this.currentModel) {
                await this.startChat();
            } else {
                await this.showMenu();
            }
        });
    }

    async initModel(model, modelName) {
        this.currentModel = model;
        this.currentModelType = modelName;
        this.isRandomMode = false;
        this.memoryManager = new MemoryManager();
        
        if (this.currentModel.setMode) {
            this.currentModel.setMode(this.currentMode);
        }
        
        const currentModeName = this.availableModes.find(m => m.value === this.currentMode)?.name || 'Normal';
        
        console.log(chalk.hex(this.colors.success)(`
✅ Model ${modelName} aktif!
✅ Mode ${currentModeName} aktif!
        `));
        
        await this.showModeMenu();
    }

    async initRandomModel() {
        const randomModel = new RandomModel();
        const selectedModelName = randomModel.selectRandom();
        this.currentModel = randomModel;
        this.currentModelType = `Random (${selectedModelName})`;
        this.isRandomMode = true;
        this.memoryManager = new MemoryManager();
        
        if (this.currentModel.setMode) {
            this.currentModel.setMode(this.currentMode);
        }
        
        const currentModeName = this.availableModes.find(m => m.value === this.currentMode)?.name || 'Normal';
        
        console.log(chalk.hex(this.colors.secondary)(`
🎲 MODE RANDOM AKTIF!
🤖 Model terpilih: ${selectedModelName}
✅ Mode ${currentModeName} aktif!
💡 Model akan TETAP dalam 1 sesi chat ini.
        `));
        
        await this.showModeMenu();
    }

    async startChat() {
        const currentModeName = this.availableModes.find(m => m.value === this.currentMode)?.name || 'Normal';
        
        console.log(chalk.hex(this.colors.info)(`
┌─────────────────────────────────────────────────────────────┐
│  Model: ${this.currentModelType}  |  Mode: ${currentModeName}                      │
├─────────────────────────────────────────────────────────────┤
│  Perintah:                                                  │
│  • "exit"   - Keluar                                       │
│  • "model"  - Ganti model AI                               │
│  • "mode"   - Ganti mode AI                                │
│  • "cdn"    - Upload file ke CDN                           │
│  • "memory" - Lihat ringkasan memory                       │
│  • "clear"  - Hapus memory                                 │
│  • "stats"  - Statistik memory                             │
│  • "sandbox" - Status sandbox                              │
└─────────────────────────────────────────────────────────────┘
        `));
        
        this.rl.prompt();
    }

    async handleInput(input) {
        const command = input.trim().toLowerCase();
        
        if (command === 'exit') {
            this.rl.close();
            return;
        }
        
        if (command === 'model') {
            await this.showMenu();
            return;
        }
        
        if (command === 'mode') {
            await this.showModeMenu();
            return;
        }
        
        if (command === 'cdn') {
            await this.handleUpload();
            this.rl.prompt();
            return;
        }
        
        if (command === 'memory') {
            await this.showMemory();
            this.rl.prompt();
            return;
        }
        
        if (command === 'clear') {
            this.memoryManager = new MemoryManager();
            console.log(chalk.hex(this.colors.success)('\n✅ Memory percakapan telah dihapus!\n'));
            this.rl.prompt();
            return;
        }
        
        if (command === 'stats') {
            await this.showStats();
            this.rl.prompt();
            return;
        }
        
        if (command === 'sandbox') {
            await this.showSandboxStatus();
            this.rl.prompt();
            return;
        }
        
        if (command === 'setuju' || command === 'gas') {
            if (this.pendingSandboxRequest) {
                await this.executeSandboxRequest(this.pendingSandboxRequest);
                this.pendingSandboxRequest = null;
            } else {
                console.log(chalk.hex(this.colors.error)('\n❌ Tidak ada request sandbox yang pending.\n'));
            }
            this.rl.prompt();
            return;
        }
        
        if (input.length > 0) {
            await this.processUserMessage(input);
        }
        
        this.rl.prompt();
    }

    async processUserMessage(message) {
        this.memoryManager.add('user', message);
        
        const context = this.memoryManager.getContext(3000);
        const importantInfo = this.memoryManager.getImportantInfo();
        const currentModeName = this.availableModes.find(m => m.value === this.currentMode)?.name || 'Normal';
        const systemPrompt = getSystemPrompt(this.currentMode);
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'system', content: `Konteks percakapan sebelumnya: ${context}` },
            { role: 'system', content: `Mode saat ini: ${currentModeName}. Sesuaikan gaya respons dengan mode ini.` }
        ];
        
        if (importantInfo.userInfo.name) {
            messages.push({ role: 'system', content: `Info user: Nama: ${importantInfo.userInfo.name}` });
        }
        
        if (importantInfo.tasks.length > 0) {
            messages.push({ role: 'system', content: `Task pending: ${importantInfo.tasks.join(', ')}` });
        }
        
        messages.push({ role: 'user', content: message });
        
        await this.loadingAnimation('Memproses dengan ' + this.currentModelType, 1200);
        
        let response;
        if (this.currentModel.streamChat) {
            console.log(chalk.hex(this.colors.primary)('\n🤖 Megaverse:\n'));
            
            let fullResponse = '';
            response = await this.currentModel.streamChat(messages, async (chunk) => {
                await this.typingAnimation(chunk, 15);
                fullResponse += chunk;
            });
            
            if (!response.success) {
                console.log(chalk.hex(this.colors.error)(`\n❌ Error: ${response.error}\n`));
                return;
            }
            
            response.content = fullResponse;
        } else {
            response = await this.currentModel.chat(messages);
            
            if (!response.success) {
                console.log(chalk.hex(this.colors.error)(`\n❌ Error: ${response.error}\n`));
                return;
            }
            
            console.log(chalk.hex(this.colors.primary)('\n🤖 Megaverse:\n'));
            await this.typingAnimation(response.content, 20);
        }
        
        const mediaDetected = this.cdnManager.extractMediaFromText(response.content);
        if (mediaDetected.length > 0) {
            console.log(chalk.hex(this.colors.accent)('\n📸 Mendeteksi media dalam response...'));
            await this.loadingAnimation('Upload ke CDN otomatis', 1500);
            
            const uploadResult = await this.cdnManager.autoUploadMediaInText(response.content);
            
            if (uploadResult.uploaded.length > 0) {
                console.log(chalk.hex(this.colors.success)('\n✅ CDN Upload berhasil!'));
                for (const media of uploadResult.uploaded) {
                    console.log(chalk.hex(this.colors.info)(`   📁 ${media.type}: ${media.cdn}`));
                }
                response.content = uploadResult.text;
            }
        }
        
        if (response.content.includes('sandbox') || 
            response.content.toLowerCase().includes('butuh menjalankan kode') ||
            response.content.toLowerCase().includes('perlu menjalankan kode')) {
            
            const sandboxMatch = response.content.match(/sandbox untuk:?([^\.!]+)/i) ||
                                response.content.match(/butuh menjalankan kode untuk:?([^\.!]+)/i) ||
                                response.content.match(/perlu menjalankan kode untuk:?([^\.!]+)/i);
            
            if (sandboxMatch) {
                this.pendingSandboxRequest = {
                    instruction: sandboxMatch[1].trim(),
                    originalResponse: response.content
                };
                
                console.log(chalk.hex(this.colors.secondary)(`
┌─────────────────────────────────────────────────────────────┐
│  🏖️  PERMINTAAN SANDBOX DETEKSI                             │
│                                                             │
│  AI membutuhkan sandbox untuk:                              │
│  ${this.pendingSandboxRequest.instruction}                  │
│                                                             │
│  Ketik ${chalk.hex(this.colors.success)('"setuju"')} atau ${chalk.hex(this.colors.success)('"gas"')} untuk mengizinkan.  │
└─────────────────────────────────────────────────────────────┘
                `));
            }
        }
        
        this.memoryManager.add('assistant', response.content, {
            media: mediaDetected.length > 0 ? mediaDetected.map(m => m.url).join(',') : null,
            responseTime: Date.now()
        });
        
        console.log(chalk.hex(this.colors.info)('\n' + '─'.repeat(60) + '\n'));
    }

    async executeSandboxRequest(request) {
        console.log(chalk.hex(this.colors.success)('\n✅ Izin sandbox diberikan!'));
        await this.loadingAnimation('Membangun sandbox environment', 2000);
        
        const sandbox = await this.sandboxManager.createSandbox(this.memoryManager.sessionId);
        console.log(chalk.hex(this.colors.info)(`🏖️ Sandbox ID: ${sandbox.id.substring(0, 16)}...`));
        
        await this.loadingAnimation('Menjalankan task otomatis di sandbox', 2000);
        
        const taskResult = await this.sandboxManager.autoCompleteTask(sandbox.id, request.instruction);
        
        console.log(chalk.hex(this.colors.success)(`
┌─────────────────────────────────────────────────────────────┐
│  ✅ TASK SANDBOX SELESAI                                    │
├─────────────────────────────────────────────────────────────┤
│  Instruksi: ${request.instruction.substring(0, 50)}...                    │
│  Durasi: ${taskResult.duration}ms                           │
│  Steps: ${taskResult.steps.length}                                          │
└─────────────────────────────────────────────────────────────┘
        `));
        
        if (taskResult.scriptResult) {
            console.log(chalk.hex(this.colors.primary)('\n📜 Output Script:'));
            console.log(taskResult.scriptResult.stdout || taskResult.scriptResult.stderr || 'No output');
        }
        
        if (taskResult.result) {
            console.log(chalk.hex(this.colors.accent)('\n🌐 HTTP Result:'));
            console.log(`Status: ${taskResult.result.status}`);
            if (typeof taskResult.result.data === 'string') {
                console.log(`Data: ${taskResult.result.data.substring(0, 500)}`);
            }
        }
        
        const sandboxInfo = this.sandboxManager.getSandboxInfo(sandbox.id);
        if (sandboxInfo && sandboxInfo.fileCount > 0) {
            console.log(chalk.hex(this.colors.info)(`\n📁 Files created: ${sandboxInfo.fileCount}`));
            const files = await this.sandboxManager.listFiles(sandbox.id);
            for (const file of files) {
                console.log(`   - ${file.name} (${file.size} bytes)`);
            }
        }
        
        this.memoryManager.add('system', `Sandbox executed: ${request.instruction}`, {
            sandboxId: sandbox.id,
            duration: taskResult.duration,
            steps: taskResult.steps.length
        });
        
        console.log(chalk.hex(this.colors.secondary)('\n💡 Sandbox akan otomatis dibersihkan dalam 1 jam.\n'));
    }

    async handleUpload() {
        this.rl.question(chalk.hex(this.colors.info)('📁 Path file yang mau diupload: '), async (filePath) => {
            try {
                await fs.access(filePath);
                
                console.log('');
                await this.loadingAnimation('Upload ke CDN', 2000);
                
                const result = await this.cdnManager.uploadFile(filePath);
                
                if (result.success) {
                    console.log(chalk.hex(this.colors.success)(`
┌─────────────────────────────────────────────────────────────┐
│  ✅ UPLOAD BERHASIL                                         │
├─────────────────────────────────────────────────────────────┤
│  🔗 URL: ${result.url}                                      │
│  📄 Nama: ${result.metadata.original_name}                             │
│  💾 Size: ${result.metadata.size_formatted}                             │
│  ⏰ Expires: ${result.metadata.expires}                                 │
└─────────────────────────────────────────────────────────────┘
                    `));
                } else {
                    console.log(chalk.hex(this.colors.error)(`\n❌ Upload gagal: ${result.error}\n`));
                }
            } catch (error) {
                console.log(chalk.hex(this.colors.error)(`\n❌ File tidak ditemukan: ${filePath}\n`));
            }
            
            this.rl.prompt();
        });
    }

    async showMemory() {
        console.log(chalk.hex(this.colors.secondary)('\n📚 RINGKASAN MEMORY PERCAKAPAN:\n'));
        
        const context = this.memoryManager.getContext();
        const important = this.memoryManager.getImportantInfo();
        
        if (important.userInfo.name) {
            console.log(chalk.hex(this.colors.info)(`👤 User: ${important.userInfo.name}`));
        }
        
        if (important.userInfo.email) {
            console.log(chalk.hex(this.colors.info)(`📧 Email: ${important.userInfo.email}`));
        }
        
        if (important.tasks.length > 0) {
            console.log(chalk.hex(this.colors.accent)(`\n📋 Task yang pernah diminta:`));
            important.tasks.forEach(task => console.log(`   • ${task}`));
        }
        
        if (important.codeSnippets.length > 0) {
            console.log(chalk.hex(this.colors.primary)(`\n💻 Code snippets:`));
            important.codeSnippets.forEach(code => console.log(`   • ${code.substring(0, 80)}...`));
        }
        
        console.log(chalk.hex(this.colors.info)(`\n📝 Konteks percakapan:\n${context.substring(0, 1000)}`));
        
        if (context.length > 1000) {
            console.log(chalk.hex(this.colors.info)('\n...[dan seterusnya]...'));
        }
        
        console.log(chalk.hex(this.colors.info)('\n' + '─'.repeat(60) + '\n'));
    }

    async showStats() {
        const stats = this.memoryManager.getStats();
        
        console.log(chalk.hex(this.colors.secondary)(`
┌─────────────────────────────────────────────────────────────┐
│  📊 STATISTIK MEMORY                                        │
├─────────────────────────────────────────────────────────────┤
│  Session ID: ${stats.sessionId.substring(0, 16)}...                         │
│  Total Messages: ${stats.totalMessages}                                    │
│  Short Term: ${stats.shortTermCount}                                       │
│  Long Term: ${stats.longTermCount}                                         │
│  Compressions: ${stats.compressions}                                       │
│  Tokens Saved: ~${Math.floor(stats.tokensSaved / 1000)}k                   │
│  Summary Length: ${stats.summaryLength} karakter                            │
│  Session Age: ${Math.floor(stats.age / 1000)} detik                         │
└─────────────────────────────────────────────────────────────┘
        `));
    }

    async showSandboxStatus() {
        const sandboxes = Array.from(this.sandboxManager.activeSandboxes.values());
        
        if (sandboxes.length === 0) {
            console.log(chalk.hex(this.colors.info)('\n🏖️ Tidak ada sandbox aktif saat ini.\n'));
            return;
        }
        
        console.log(chalk.hex(this.colors.secondary)(`
┌─────────────────────────────────────────────────────────────┐
│  🏖️  SANDBOX AKTIF                                          │
├─────────────────────────────────────────────────────────────┤
        `));
        
        for (const sb of sandboxes) {
            const info = this.sandboxManager.getSandboxInfo(sb.id);
            if (info) {
                console.log(chalk.hex(this.colors.primary)(`
  ID: ${info.id.substring(0, 16)}...
  Age: ${Math.floor(info.age / 1000)} detik
  Files: ${info.fileCount}
  Commands: ${info.commandCount}
  Processes: ${info.processes.length}
                `));
            }
        }
        
        console.log(chalk.hex(this.colors.secondary)('└─────────────────────────────────────────────────────────────┘\n'));
    }
}

module.exports = CLIMain;
