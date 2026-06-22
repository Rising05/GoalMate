import { Injectable } from "@nestjs/common";
import { connect } from "node:net";

export const FILE_SCANNER = Symbol("FILE_SCANNER");

export interface FileScanResult {
  clean: boolean;
  signature?: string;
  message: string;
}

export interface FileScanner {
  readonly name: string;
  scan(content: Buffer): Promise<FileScanResult>;
}

@Injectable()
export class MockFileScanner implements FileScanner {
  readonly name = "MOCK";

  async scan(content: Buffer): Promise<FileScanResult> {
    const text = content.toString("utf8");
    if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      return { clean: false, signature: "Eicar-Test-Signature", message: "Test malware signature detected" };
    }
    return { clean: true, message: "Mock scanner passed" };
  }
}

@Injectable()
export class ClamAvFileScanner implements FileScanner {
  readonly name = "CLAMAV";

  scan(content: Buffer): Promise<FileScanResult> {
    const host = process.env.CLAMAV_HOST?.trim() || "127.0.0.1";
    const port = Number(process.env.CLAMAV_PORT || 3310);
    const timeoutMs = Math.max(1000, Number(process.env.CLAMAV_TIMEOUT_MS || 30_000));
    const chunkSize = 64 * 1024;

    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      const response: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => socket.destroy(new Error("ClamAV scan timed out")), timeoutMs);
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const result = Buffer.concat(response).toString("utf8").replace(/\0/g, "").trim();
        socket.destroy();
        if (result.endsWith(" OK")) resolve({ clean: true, message: result });
        else if (result.includes(" FOUND")) {
          const signature = result.match(/: (.+) FOUND/)?.[1] ?? "UNKNOWN";
          resolve({ clean: false, signature, message: result });
        } else reject(new Error(`ClamAV returned an invalid response: ${result || "empty"}`));
      };
      socket.on("data", (chunk) => {
        response.push(Buffer.from(chunk));
        if (chunk.includes(0)) finish();
      });
      socket.once("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < content.length; offset += chunkSize) {
          const chunk = content.subarray(offset, Math.min(content.length, offset + chunkSize));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length, 0);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.once("end", finish);
    });
  }
}
