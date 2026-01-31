/**
 * Emitter - LLVM IR string builder
 * 
 * Generates LLVM IR text that can be compiled to native code via clang.
 */
export class Emitter {
    private buffer: string[] = [];
    private declarations: string[] = [];  // External function declarations
    private structTypes: string[] = [];   // Struct type definitions
    private stringConstants: Map<string, string> = new Map();  // String literals
    private stringCounter: number = 0;
    private indentLevel: number = 0;
    private targetTriple: string;

    constructor(moduleName: string, targetTriple: string = "arm64-apple-macosx") {
        this.targetTriple = targetTriple;
        this.emitModuleHeader(moduleName);
    }

    /**
     * Emit the LLVM module header
     */
    private emitModuleHeader(moduleName: string): void {
        this.emitLine(`; ModuleID = '${moduleName}'`);
        this.emitLine(`target triple = "${this.targetTriple}"`);
        this.emitLine("");
    }

    /**
     * Append raw string to buffer
     */
    emit(text: string): void {
        this.buffer.push(text);
    }

    /**
     * Append line with proper indentation and newline
     */
    emitLine(text: string = ""): void {
        const indent = "    ".repeat(this.indentLevel);
        this.buffer.push(indent + text + "\n");
    }

    /**
     * Increase indentation level
     */
    indent(): void {
        this.indentLevel++;
    }

    /**
     * Decrease indentation level
     */
    dedent(): void {
        if (this.indentLevel > 0) {
            this.indentLevel--;
        }
    }

    /**
     * Emit a function definition
     */
    emitFunctionStart(name: string, returnType: string, params: string = ""): void {
        this.emitLine(`define ${returnType} @${name}(${params}) {`);
        this.emitLine("entry:");
        this.indent();
    }

    /**
     * Emit function end
     */
    emitFunctionEnd(): void {
        this.dedent();
        this.emitLine("}");
        this.emitLine("");
    }

    /**
     * Emit a return statement
     */
    emitReturn(type: string, value: string): void {
        this.emitLine(`ret ${type} ${value}`);
    }

    /**
     * Emit a label (basic block start)
     */
    emitLabel(label: string): void {
        this.dedent();
        this.emitLine(`${label}:`);
        this.indent();
    }

    /**
     * Emit an unconditional branch
     */
    emitBranch(label: string): void {
        this.emitLine(`br label %${label}`);
    }

    /**
     * Emit a conditional branch
     */
    emitConditionalBranch(condition: string, trueLabel: string, falseLabel: string): void {
        this.emitLine(`br i1 ${condition}, label %${trueLabel}, label %${falseLabel}`);
    }

    /**
     * Emit a binary operation
     */
    emitBinaryOp(
        resultVar: string,
        op: string,
        type: string,
        left: string,
        right: string
    ): void {
        this.emitLine(`${resultVar} = ${op} ${type} ${left}, ${right}`);
    }

    /**
     * Emit an alloca instruction (stack allocation)
     */
    emitAlloca(resultVar: string, type: string): void {
        this.emitLine(`${resultVar} = alloca ${type}`);
    }

    /**
     * Emit a bitcast instruction (type conversion)
     */
    emitBitcast(resultVar: string, fromType: string, value: string, toType: string): void {
        this.emitLine(`${resultVar} = bitcast ${fromType} ${value} to ${toType}`);
    }

    /**
     * Add a struct type definition
     */
    addStructType(name: string, fieldTypes: string[]): void {
        const fields = fieldTypes.join(", ");
        this.structTypes.push(`%${name} = type { ${fields} }`);
    }

    /**
     * Emit a store instruction
     */
    emitStore(type: string, value: string, ptr: string): void {
        this.emitLine(`store ${type} ${value}, ${type}* ${ptr}`);
    }

    /**
     * Emit a load instruction
     */
    emitLoad(resultVar: string, type: string, ptr: string): void {
        this.emitLine(`${resultVar} = load ${type}, ${type}* ${ptr}`);
    }

    /**
     * Emit a function call
     */
    emitCall(resultVar: string | null, returnType: string, funcName: string, args: string): void {
        if (resultVar && returnType !== "void") {
            this.emitLine(`${resultVar} = call ${returnType} @${funcName}(${args})`);
        } else {
            this.emitLine(`call ${returnType} @${funcName}(${args})`);
        }
    }

    /**
     * Emit a function call with variadic arguments (like printf)
     */
    emitVariadicCall(resultVar: string | null, returnType: string, funcName: string, args: string): void {
        if (resultVar && returnType !== "void") {
            this.emitLine(`${resultVar} = call ${returnType} (i8*, ...) @${funcName}(${args})`);
        } else {
            this.emitLine(`call ${returnType} (i8*, ...) @${funcName}(${args})`);
        }
    }

    /**
     * Add an external function declaration
     */
    addExternFunction(name: string, returnType: string, params: string, isVariadic: boolean = false): void {
        const variadicSuffix = isVariadic ? ", ..." : "";
        const decl = `declare ${returnType} @${name}(${params}${variadicSuffix})`;
        if (!this.declarations.includes(decl)) {
            this.declarations.push(decl);
        }
    }

    /**
     * Add a string constant and return its global name
     */
    addStringConstant(value: string): { name: string; length: number } {
        // Check if we already have this string
        if (this.stringConstants.has(value)) {
            const byteLen = this.calculateByteLength(value);
            return { name: this.stringConstants.get(value)!, length: byteLen };
        }

        const name = `@.str.${this.stringCounter++}`;
        this.stringConstants.set(value, name);
        const byteLen = this.calculateByteLength(value);
        return { name, length: byteLen };
    }

    /**
     * Calculate the actual byte length of a string after escape processing
     */
    private calculateByteLength(str: string): number {
        let len = 0;
        for (let i = 0; i < str.length; i++) {
            if (str[i] === "\\" && i + 1 < str.length) {
                const next = str[i + 1];
                if (["n", "t", "r", "\\", '"'].includes(next)) {
                    len++;  // Escape sequence counts as 1 byte
                    i++;    // Skip the next character
                    continue;
                }
            }
            len++;
        }
        return len + 1;  // +1 for null terminator
    }

    /**
     * Emit a getelementptr instruction for accessing string data
     */
    emitGetElementPtr(resultVar: string, arrayType: string, ptrType: string, ptr: string, indices: string): void {
        this.emitLine(`${resultVar} = getelementptr ${arrayType}, ${ptrType} ${ptr}, ${indices}`);
    }

    /**
     * Emit a comment
     */
    emitComment(comment: string): void {
        this.emitLine(`; ${comment}`);
    }

    /**
     * Get the complete LLVM IR output
     */
    getOutput(): string {
        // Build the complete output with declarations and string constants at the top
        let output = "";

        // Module header is already in buffer
        const headerEnd = this.buffer.findIndex(line => line === "\n");
        output += this.buffer.slice(0, headerEnd + 1).join("");

        // Add struct type definitions first
        for (const structType of this.structTypes) {
            output += structType + "\n";
        }
        if (this.structTypes.length > 0) {
            output += "\n";
        }

        // Add external declarations
        for (const decl of this.declarations) {
            output += decl + "\n";
        }
        if (this.declarations.length > 0) {
            output += "\n";
        }

        // Add string constants
        for (const [str, name] of this.stringConstants) {
            const escaped = this.escapeString(str);
            const len = this.calculateByteLength(str);
            output += `${name} = private unnamed_addr constant [${len} x i8] c"${escaped}\\00"\n`;
        }
        if (this.stringConstants.size > 0) {
            output += "\n";
        }

        // Add the rest of the buffer (function definitions)
        output += this.buffer.slice(headerEnd + 1).join("");

        return output;
    }

    /**
     * Escape a string for LLVM IR
     */
    private escapeString(str: string): string {
        let result = "";
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            const code = str.charCodeAt(i);

            if (char === "\\") {
                // Handle escape sequences
                if (i + 1 < str.length) {
                    const next = str[i + 1];
                    if (next === "n") {
                        result += "\\0A";  // newline
                        i++;
                        continue;
                    } else if (next === "t") {
                        result += "\\09";  // tab
                        i++;
                        continue;
                    } else if (next === "r") {
                        result += "\\0D";  // carriage return
                        i++;
                        continue;
                    } else if (next === "\\") {
                        result += "\\5C";  // backslash
                        i++;
                        continue;
                    } else if (next === '"') {
                        result += "\\22";  // double quote
                        i++;
                        continue;
                    }
                }
                result += "\\5C";
            } else if (char === '"') {
                result += "\\22";
            } else if (code < 32 || code > 126) {
                // Non-printable: use hex escape
                result += "\\" + code.toString(16).padStart(2, "0").toUpperCase();
            } else {
                result += char;
            }
        }
        return result;
    }
}
