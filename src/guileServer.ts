import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';


export class GuileServer {
    private process: cp.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;
    private isRunning = false;
    public port = -1;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel("Beguile Server");
        this.outputChannel.show(true);
    }

    public async start(extensionPath: string): Promise<number> {
        if (this.isRunning) return -1;
        const serverPath = path.join(extensionPath, "guile/server.scm");

        const portPromise = new Promise<number>((resolve, reject) => {
            const server = net.createServer();
            server.listen(0, () => {
                const port = (server.address() as net.AddressInfo).port;
                server.close(() => resolve(port));
            });
            server.on('error', reject);
        });

        this.port = await portPromise;

        this.outputChannel.appendLine(`Spawning: guile ${serverPath} --port ${this.port}`);

        this.process = cp.spawn("guile", [serverPath, "--port", String(this.port)], {
            cwd: extensionPath
        });
        this.isRunning = true;

        console.log("Guile server running on port", this.port);


        this.isRunning = true;

        if (this.process.stdout) {
            this.process.stdout.on('data', (data) => {
                this.outputChannel.append(`${data}`);
            });
        }

        if (this.process.stderr) {
            this.process.stderr.on('data', (data) => {
                this.outputChannel.append(`ERR: ${data}`);
            });
        }

        this.process.on('close', (code) => {
            this.outputChannel.appendLine(`Guile Server stopped (Exit Code: ${code})`);
            this.isRunning = false;
            this.process = null;
        });

        this.process.on('error', (err) => {
            this.outputChannel.appendLine(`FAILED TO START GUILE: ${err.message}`);
            vscode.window.showErrorMessage(`Beguile: Could not start Guile process. Is 'guile' in your PATH?`);
            this.isRunning = false;
        });
        return this.port;
    }

    public stop() {
        if (this.process) {
            this.outputChannel.appendLine("Killing Guile Server...");
            this.process.kill();
            this.process = null;
            this.isRunning = false;
        }
    }

    public restart(extensionPath: string) {
        this.stop();
        setTimeout(() => this.start(extensionPath), 500);
    }
}