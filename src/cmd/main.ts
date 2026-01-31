#!/usr/bin/env node

/**
 * MicroTS CLI Entry Point
 * 
 * Usage: microts <input.ts> [options]
 */

import * as fs from "fs";
import * as path from "path";
import { compileToIR } from "../compiler/ASTWalker";
import { SystemRunner } from "../utils/SystemRunner";

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log("MicroTS - TypeScript to Native Compiler");
        console.log("");
        console.log("Usage: microts <input.ts> [options]");
        console.log("");
        console.log("Options:");
        console.log("  --emit-llvm    Only emit LLVM IR, don't compile to executable");
        console.log("  --run          Run the compiled executable after compilation");
        console.log("  -o <file>      Output file path");
        process.exit(1);
    }

    // Parse arguments
    const inputFile = args[0];
    const emitLLVMOnly = args.includes("--emit-llvm");
    const runAfterCompile = args.includes("--run");

    let outputFile: string | undefined;
    const outputIdx = args.indexOf("-o");
    if (outputIdx !== -1 && args[outputIdx + 1]) {
        outputFile = args[outputIdx + 1];
    }

    // Resolve input path
    const inputPath = path.resolve(inputFile);

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: File not found: ${inputPath}`);
        process.exit(1);
    }

    console.log(`Compiling: ${inputPath}`);

    try {
        // Step 1: Generate LLVM IR
        const llvmIR = compileToIR(inputPath);

        // Write .ll file
        const parsedPath = path.parse(inputPath);
        const llFilePath = path.join(parsedPath.dir, `${parsedPath.name}.ll`);
        fs.writeFileSync(llFilePath, llvmIR);
        console.log(`Generated: ${llFilePath}`);

        if (emitLLVMOnly) {
            console.log("\n--- LLVM IR ---");
            console.log(llvmIR);
            return;
        }

        // Step 2: Compile to native executable
        const executablePath = outputFile || path.join(parsedPath.dir, parsedPath.name);
        const compileResult = await SystemRunner.compileIR(llFilePath, executablePath);

        if (!compileResult.success) {
            console.error(`Compilation failed: ${compileResult.error}`);
            process.exit(1);
        }

        console.log(`Compiled: ${executablePath}`);

        // Step 3: Optionally run the executable
        if (runAfterCompile) {
            console.log("\n--- Running executable ---");
            const runResult = await SystemRunner.runExecutable(executablePath);
            if (runResult.output) {
                console.log(runResult.output);
            }
            console.log(`Exit code: ${runResult.exitCode}`);
        }

    } catch (error) {
        if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error("Unknown error occurred");
        }
        process.exit(1);
    }
}

main();
