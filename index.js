#!/usr/bin/env node

const CLIMain = require('./src/cli/CLIMain');
const { MODES, getSystemPrompt } = require('./src/prompts/SystemPrompt');

async function main() {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║    ███╗   ███╗███████╗ ██████╗  █████╗ ██╗   ██╗███████╗██████╗ ███████╗  ║
║    ████╗ ████║██╔════╝██╔════╝ ██╔══██╗██║   ██║██╔════╝██╔══██╗██╔════╝  ║
║    ██╔████╔██║█████╗  ██║  ███╗███████║██║   ██║███████╗██████╔╝█████╗    ║
║    ██║╚██╔╝██║██╔══╝  ██║   ██║██╔══██║╚██╗ ██╔╝╚════██║██╔══██╗██╔══╝    ║
║    ██║ ╚═╝ ██║███████╗╚██████╔╝██║  ██║ ╚████╔╝ ███████║██║  ██║███████╗  ║
║    ╚═╝     ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚══════╝  ║
║                                                                           ║
║                    CLI CHAT AI ULTIMATE - MEGAVERSE                       ║
║                    Versi: 2.0.0 | Mode Multi-System Prompt               ║
║                                                                           ║
║  Mode yang tersedia:                                                      ║
${MODES.map(m => `║    ${m.id}. ${m.name.padEnd(12)} - ${m.description.padEnd(40)}║`).join('\n')}
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);

    const cli = new CLIMain();
    
    process.on('uncaughtException', (error) => {
        console.error('\n❌ Error:', error.message);
    });
    
    process.on('unhandledRejection', (reason) => {
        console.error('\n❌ Error:', reason);
    });
    
    await cli.init();
}

main().catch(console.error);