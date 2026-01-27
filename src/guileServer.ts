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
        if (this.isRunning) return this.port;
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

        return new Promise((resolve) => {
            this.process!.stdout?.on('data', (data) => {
                const msg = data.toString();
                this.outputChannel.append(msg);
                if (msg.includes("(Beguile Server Ready)")) {
                    this.isRunning = true;
                    resolve(this.port);
                }
            });
            this.process!.on('error', () => resolve(-1));
        });
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