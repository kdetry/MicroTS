import * as ts from "typescript";

/**
 * TypeMapper - Converts TypeScript types to LLVM types
 */
export class TypeMapper {
    /**
     * Map a TypeScript type string to LLVM type
     */
    static mapType(tsType: string): string {
        switch (tsType.toLowerCase()) {
            case "number":
                return "i32";  // Default integers to 32-bit
            case "i32":
                return "i32";
            case "i64":
                return "i64";
            case "f32":
                return "float";
            case "f64":
                return "double";
            case "boolean":
            case "bool":
                return "i1";
            case "string":
                return "i8*";  // C string pointer
            case "void":
                return "void";
            case "number[]":
                return "i32*";  // Pointer to i32
            default:
                // Handle pointer types
                if (tsType.endsWith("[]")) {
                    const baseType = tsType.slice(0, -2);
                    return this.mapType(baseType) + "*";
                }
                console.warn(`Unknown type "${tsType}", defaulting to i32`);
                return "i32";
        }
    }

    /**
     * Get the LLVM type from a TypeScript AST TypeNode
     */
    static mapTypeNode(node: ts.TypeNode | undefined, sourceFile: ts.SourceFile): string {
        if (!node) {
            return "i32";  // Default
        }

        const typeText = node.getText(sourceFile);
        return this.mapType(typeText);
    }

    /**
     * Get the size in bytes for an LLVM type
     */
    static sizeOf(llvmType: string): number {
        switch (llvmType) {
            case "i1":
                return 1;
            case "i8":
                return 1;
            case "i16":
                return 2;
            case "i32":
            case "float":
                return 4;
            case "i64":
            case "double":
                return 8;
            default:
                if (llvmType.endsWith("*")) {
                    return 8;  // Pointer size (64-bit)
                }
                return 4;  // Default
        }
    }

    /**
     * Check if a type is a floating point type
     */
    static isFloat(llvmType: string): boolean {
        return llvmType === "float" || llvmType === "double";
    }

    /**
     * Check if a type is an integer type
     */
    static isInteger(llvmType: string): boolean {
        return llvmType.startsWith("i") && !llvmType.endsWith("*");
    }

    /**
     * Get the appropriate binary operation for a type
     */
    static getBinaryOp(op: string, llvmType: string): string {
        const isFloat = this.isFloat(llvmType);

        switch (op) {
            case "+":
                return isFloat ? "fadd" : "add";
            case "-":
                return isFloat ? "fsub" : "sub";
            case "*":
                return isFloat ? "fmul" : "mul";
            case "/":
                return isFloat ? "fdiv" : "sdiv";  // Signed division
            case "%":
                return isFloat ? "frem" : "srem";  // Signed remainder
            default:
                throw new Error(`Unknown binary operator: ${op}`);
        }
    }

    /**
     * Get the appropriate comparison operation for a type
     */
    static getCompareOp(op: string, llvmType: string): { instruction: string; predicate: string } {
        const isFloat = this.isFloat(llvmType);

        if (isFloat) {
            const predicates: Record<string, string> = {
                "<": "olt",
                ">": "ogt",
                "<=": "ole",
                ">=": "oge",
                "==": "oeq",
                "===": "oeq",
                "!=": "one",
                "!==": "one",
            };
            return { instruction: "fcmp", predicate: predicates[op] || "oeq" };
        } else {
            const predicates: Record<string, string> = {
                "<": "slt",   // Signed less than
                ">": "sgt",   // Signed greater than
                "<=": "sle",  // Signed less or equal
                ">=": "sge",  // Signed greater or equal
                "==": "eq",
                "===": "eq",
                "!=": "ne",
                "!==": "ne",
            };
            return { instruction: "icmp", predicate: predicates[op] || "eq" };
        }
    }
}
