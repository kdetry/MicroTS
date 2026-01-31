import { spawn, SpawnOptions } from "child_process";
import * as path from "path";

export interface CompileResult {
    success: boolean;
    output: string;
    error?: string;
}

/**
 * SystemRunner - Executes shell commands, primarily for invoking clang
 */
export class SystemRunner {
    /**
     * Execute a command and return the result
     */
    static async exec(
        command: string,
        args: string[],
        options?: SpawnOptions
    ): Promise<CompileResult> {
        return new Promise((resolve) => {
            const proc = spawn(command, args, {
                ...options,
                shell: false,
            });

            let stdout = "";
            let stderr = "";

            proc.stdout?.on("data", (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on("data", (data) => {
                stderr += data.toString();
            });

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve({
                        success: true,
                        output: stdout,
                    });
                } else {
                    resolve({
                        success: false,
                        output: stdout,
                        error: stderr || `Process exited with code ${code}`,
                    });
                }
            });

            proc.on("error", (err) => {
                resolve({
                    success: false,
                    output: "",
                    error: err.message,
                });
            });
        });
    }

    /**
     * Compile LLVM IR (.ll) to native executable using clang
     */
    static async compileIR(llFilePath: string, outputPath?: string): Promise<CompileResult> {
        const parsedPath = path.parse(llFilePath);
        const executablePath = outputPath || path.join(parsedPath.dir, parsedPath.name);

        // Use clang to compile .ll directly to executable
        const result = await this.exec("clang", [
            llFilePath,
            "-o",
            executablePath,
            "-Wno-override-module",  // Suppress target triple mismatch warnings
        ]);

        if (result.success) {
            result.output = `Compiled: ${executablePath}`;
        }

        return result;
    }

    /**
     * Run a compiled executable and return its exit code
     */
    static async runExecutable(executablePath: string): Promise<{ exitCode: number; output: string }> {
        return new Promise((resolve) => {
            const proc = spawn(executablePath, [], {
                shell: false,
            });

            let output = "";

            proc.stdout?.on("data", (data) => {
                output += data.toString();
            });

            proc.stderr?.on("data", (data) => {
                output += data.toString();
            });

            proc.on("close", (code) => {
                resolve({
                    exitCode: code ?? -1,
                    output,
                });
            });

            proc.on("error", (err) => {
                resolve({
                    exitCode: -1,
                    output: err.message,
                });
            });
        });
    }
}
