import * as cp from "child_process";
import * as path from "path";
import * as readline from "readline";

export class GuileClient {
  private proc: cp.ChildProcessWithoutNullStreams;
  private rl: readline.Interface;
  private responseQueue: ((val: any) => void)[] = [];

  constructor() {
    const serverPath = path.join(__dirname, "..", "guile", "server.scm");

    this.proc = cp.spawn("guile", ["--no-auto-compile", serverPath], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, GUILE_AUTO_COMPILE: "0" }
    });

    this.rl = readline.createInterface({
      input: this.proc.stdout,
      terminal: false
    });

    this.rl.on("line", (line) => {
      const resolve = this.responseQueue.shift();
      if (resolve) {
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          console.error("Failed to parse Guile JSON:", line);
        }
      }
    });

    this.proc.stderr.on("data", d => console.error("Guile stderr:", d.toString()));
  }

  async send<T>(msg: [string, any]): Promise<T> {
    return new Promise((resolve) => {
      this.responseQueue.push(resolve);
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }
  async format(code: string): Promise<string> {
    const response = await this.send<any>(["format", code]);

    if (response?.status === "ok" && typeof response.result === "string") {
      if (response.result.trim().length === 0 && code.trim().length > 0) {
        console.warn("Guile returned empty string for non-empty input. Aborting format.");
        return code;
      }
      return response.result;
    }

    console.error("Guile format failed or returned invalid JSON:", response);
    return code;
  }
}