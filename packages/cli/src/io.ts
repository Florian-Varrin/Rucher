export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  color: boolean;
  columns: number;
}

export interface ProcessIoOptions {
  color?: boolean;
}

export function processIo(options: ProcessIoOptions = {}): Io {
  const tty = process.stdout.isTTY === true;
  const colorWanted = options.color ?? true;
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    env: process.env,
    color: tty && colorWanted && !process.env.NO_COLOR,
    columns: process.stdout.columns ?? 80,
  };
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
