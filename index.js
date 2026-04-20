#!/usr/bin/env node

const CLIMain = require('./src/cli/CLIMain');

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
║                    Zero Filter | Zero Batasan | Zero Hukum               ║
║                    Versi: 1.0.0 | Mode: DEWA                             ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);

    const cli = new CLIMain();
    
    process.on('uncaughtException', (error) => {
        console.error('\n❌ Uncaught Error:', error.message);
    });
    
    process.on('unhandledRejection', (reason) => {
        console.error('\n❌ Unhandled Rejection:', reason);
    });
    
    await cli.init();
}

main().catch(console.error);