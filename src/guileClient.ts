import * as net from 'net';
import * as vscode from 'vscode';

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

export class GuileClient {
  private client: net.Socket | null = null;
  private requestCounter = 0;
  private pendingRequests = new Map<number, (value: any) => void>();
  private isConnected = false;
  private buffer = "";
  private retryTimer: NodeJS.Timeout | undefined;

  constructor(private port: number) {
    this.connect();
  }

  private connect() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }

    if (this.client) {
      this.client.destroy();
      this.client.removeAllListeners();
      this.client = null;
    }

    this.client = new net.Socket();

    this.client.on('connect', () => {
      console.log('Beguile: Connected to Guile Server');
      this.isConnected = true;
      this.buffer = "";
    });

    this.client.on('data', (data) => this.handleData(data));

    this.client.on('error', (err) => {
      if (this.isConnected) {
        console.warn(`Beguile Socket Error: ${err.message}`);
      }
    });

    this.client.on('close', () => {
      if (this.isConnected) {
        console.log('Beguile: Server disconnected');
        this.isConnected = false;
      }

      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          this.connect();
        }, 2000);
      }
    });

    try {
      this.client.connect(this.port, '127.0.0.1');
    } catch (e: any) {
      console.error("Synchronous connect error:", e.message);
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => this.connect(), 2000);
      }
    }
  }

  private handleData(data: Buffer) {
    this.buffer += data.toString();
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex).trim();
      this.buffer = this.buffer.substring(newlineIndex + 1);

      if (!line) continue;
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        this.handleResponse(response);
      } catch (e) {
        console.error("Beguile: Failed to parse JSON:", line);
      }
    }
  }

  private handleResponse(response: JsonRpcResponse) {
    if (this.pendingRequests.has(response.id)) {
      const resolve = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);
      if (response.error) {
        console.error(`Guile Error (${response.error.code}):`, response.error.message);
        if (resolve) resolve(null);
      } else if (resolve) {
        resolve(response.result);
      }
    }
  }

  public async sendRequest(method: string, params: any = {}): Promise<any> {
    if (!this.isConnected || !this.client) return null;

    this.requestCounter++;
    const id = this.requestCounter;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve) => {
      this.pendingRequests.set(id, resolve);
      this.client?.write(JSON.stringify(req) + "\n");
    });
  }

  public async getIndentInfo(symbol: string) {
    return this.sendRequest("beguile/getIndent", { symbol });
  }

  public async getCompletions(prefix: string): Promise<string[]> {
    return this.sendRequest("beguile/completion", { prefix });
  }

  public async getDocs(symbol: string, code: string, context: string[]): Promise<string> {
    return this.sendRequest("beguile/hover", { symbol, code, context });
  }
  public async eval(code: string, moduleName: string | null): Promise<string> {
    return this.sendRequest("beguile/eval", { code, module: moduleName });
  }

  public async getDefinition(symbol: string, code: string, context: string[]): Promise<any> {
    return this.sendRequest("beguile/definition", { symbol, code, context });
  }
}