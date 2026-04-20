const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

class SandboxManager {
    constructor() {
        this.activeSandboxes = new Map();
        this.sandboxBasePath = path.join(os.tmpdir(), 'ai_sandbox_' + crypto.randomBytes(8).toString('hex'));
        this.autoCleanup = true;
        this.maxSandboxAge = 3600000;
    }

    async createSandbox(sessionId) {
        const sandboxId = crypto.randomBytes(16).toString('hex');
        const sandboxPath = path.join(this.sandboxBasePath, sandboxId);
        
        await fs.mkdir(sandboxPath, { recursive: true });
        
        const sandbox = {
            id: sandboxId,
            sessionId: sessionId,
            path: sandboxPath,
            createdAt: Date.now(),
            processes: [],
            files: new Map(),
            allowedCommands: ['node', 'python', 'python3', 'bash', 'ls', 'cat', 'echo', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'find', 'curl', 'wget', 'npm', 'pip'],
            history: []
        };
        
        this.activeSandboxes.set(sandboxId, sandbox);
        
        setTimeout(() => {
            if (this.autoCleanup && this.activeSandboxes.has(sandboxId)) {
                this.destroySandbox(sandboxId);
            }
        }, this.maxSandboxAge);
        
        return sandbox;
    }

    async executeCommand(sandboxId, command, args = [], options = {}) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) throw new Error('Sandbox tidak ditemukan');
        
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, {
                cwd: sandbox.path,
                shell: true,
                timeout: options.timeout || 30000,
                env: { ...process.env, SANDBOX_ID: sandboxId, AI_MODE: 'true' }
            });
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });
            
            proc.on('close', (code) => {
                sandbox.processes = sandbox.processes.filter(p => p.pid !== proc.pid);
                sandbox.history.push({
                    command: `${command} ${args.join(' ')}`,
                    stdout,
                    stderr,
                    exitCode: code,
                    timestamp: Date.now()
                });
                
                resolve({ stdout, stderr, exitCode: code });
            });
            
            proc.on('error', reject);
            
            sandbox.processes.push({ pid: proc.pid, command, startTime: Date.now() });
            
            if (options.stdin) {
                proc.stdin.write(options.stdin);
                proc.stdin.end();
            }
        });
    }

    async writeFile(sandboxId, filename, content) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) throw new Error('Sandbox tidak ditemukan');
        
        const filepath = path.join(sandbox.path, filename);
        const dir = path.dirname(filepath);
        
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filepath, content);
        
        sandbox.files.set(filename, {
            path: filepath,
            size: content.length,
            modified: Date.now()
        });
        
        return { success: true, path: filepath };
    }

    async readFile(sandboxId, filename) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) throw new Error('Sandbox tidak ditemukan');
        
        const filepath = path.join(sandbox.path, filename);
        const content = await fs.readFile(filepath, 'utf-8');
        
        return content;
    }

    async listFiles(sandboxId) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) throw new Error('Sandbox tidak ditemukan');
        
        const files = await fs.readdir(sandbox.path);
        const stats = await Promise.all(files.map(async f => {
            const stat = await fs.stat(path.join(sandbox.path, f));
            return { name: f, isDirectory: stat.isDirectory(), size: stat.size };
        }));
        
        return stats;
    }

    async installNpmPackage(sandboxId, packageName) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) throw new Error('Sandbox tidak ditemukan');
        
        const result = await this.executeCommand(sandboxId, 'npm', ['init', '-y']);
        const installResult = await this.executeCommand(sandboxId, 'npm', ['install', packageName]);
        
        return installResult;
    }

    async installPythonPackage(sandboxId, packageName) {
        const result = await this.executeCommand(sandboxId, 'pip', ['install', packageName]);
        return result;
    }

    async executeScript(sandboxId, language, code) {
        const filename = `script_${Date.now()}.${language === 'javascript' ? 'js' : 'py'}`;
        await this.writeFile(sandboxId, filename, code);
        
        let command, args;
        if (language === 'javascript') {
            command = 'node';
            args = [filename];
        } else if (language === 'python') {
            command = 'python3';
            args = [filename];
        } else {
            throw new Error(`Bahasa ${language} tidak didukung`);
        }
        
        const result = await this.executeCommand(sandboxId, command, args);
        return result;
    }

    async httpRequest(sandboxId, url, options = {}) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) throw new Error('Sandbox tidak ditemukan');
        
        try {
            const response = await axios({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body || null,
                timeout: options.timeout || 10000,
                validateStatus: () => true
            });
            
            sandbox.history.push({
                type: 'http_request',
                url,
                status: response.status,
                timestamp: Date.now()
            });
            
            return {
                status: response.status,
                headers: response.headers,
                data: response.data
            };
        } catch (error) {
            return {
                status: 0,
                error: error.message
            };
        }
    }

    async destroySandbox(sandboxId) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) return false;
        
        for (const proc of sandbox.processes) {
            try {
                process.kill(proc.pid);
            } catch (e) {}
        }
        
        try {
            await fs.rm(sandbox.path, { recursive: true, force: true });
        } catch (e) {}
        
        this.activeSandboxes.delete(sandboxId);
        
        return true;
    }

    getSandboxInfo(sandboxId) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) return null;
        
        return {
            id: sandbox.id,
            createdAt: sandbox.createdAt,
            age: Date.now() - sandbox.createdAt,
            fileCount: sandbox.files.size,
            commandCount: sandbox.history.length,
            processes: sandbox.processes.map(p => ({ command: p.command, running: true }))
        };
    }

    async autoCompleteTask(sandboxId, instruction) {
        const sandbox = this.activeSandboxes.get(sandboxId);
        if (!sandbox) throw new Error('Sandbox tidak ditemukan');
        
        const taskLog = {
            instruction,
            steps: [],
            startTime: Date.now(),
            completed: false
        };
        
        if (instruction.includes('install') && instruction.includes('npm')) {
            const match = instruction.match(/install\s+([a-zA-Z0-9\-@\/]+)/);
            if (match) {
                const pkg = match[1];
                taskLog.steps.push({ action: 'npm_install', package: pkg });
                await this.installNpmPackage(sandboxId, pkg);
            }
        }
        
        if (instruction.includes('install') && instruction.includes('pip')) {
            const match = instruction.match(/install\s+([a-zA-Z0-9\-_]+)/);
            if (match) {
                const pkg = match[1];
                taskLog.steps.push({ action: 'pip_install', package: pkg });
                await this.installPythonPackage(sandboxId, pkg);
            }
        }
        
        if (instruction.includes('curl') || instruction.includes('fetch') || instruction.includes('get')) {
            const urlMatch = instruction.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                const url = urlMatch[1];
                taskLog.steps.push({ action: 'http_request', url });
                const result = await this.httpRequest(sandboxId, url);
                taskLog.result = result;
            }
        }
        
        if (instruction.includes('code') || instruction.includes('script') || instruction.includes('run')) {
            const jsMatch = instruction.match(/```javascript\n([\s\S]*?)\n```/);
            const pyMatch = instruction.match(/```python\n([\s\S]*?)\n```/);
            
            if (jsMatch) {
                taskLog.steps.push({ action: 'execute_script', language: 'javascript' });
                const result = await this.executeScript(sandboxId, 'javascript', jsMatch[1]);
                taskLog.scriptResult = result;
            } else if (pyMatch) {
                taskLog.steps.push({ action: 'execute_script', language: 'python' });
                const result = await this.executeScript(sandboxId, 'python', pyMatch[1]);
                taskLog.scriptResult = result;
            }
        }
        
        taskLog.completed = true;
        taskLog.endTime = Date.now();
        taskLog.duration = taskLog.endTime - taskLog.startTime;
        
        sandbox.history.push({ type: 'auto_task', task: taskLog });
        
        return taskLog;
    }
}

module.exports = SandboxManager;
