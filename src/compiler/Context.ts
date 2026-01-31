/**
 * Context - Symbol table for tracking variable scopes
 * 
 * Manages variable declarations and their LLVM register names
 * across nested scopes (functions, blocks, etc.)
 */

export interface Variable {
    name: string;           // Original TypeScript name
    llvmName: string;       // LLVM register name (e.g., %x)
    llvmType: string;       // LLVM type (e.g., i32)
    isPointer: boolean;     // Whether this is a pointer (for alloca'd variables)
}

export class Context {
    private scopes: Map<string, Variable>[] = [];
    private tempCounter: number = 0;
    private labelCounter: number = 0;

    constructor() {
        // Start with global scope
        this.pushScope();
    }

    /**
     * Push a new scope (entering a function/block)
     */
    pushScope(): void {
        this.scopes.push(new Map());
    }

    /**
     * Pop the current scope (leaving a function/block)
     */
    popScope(): void {
        if (this.scopes.length > 1) {
            this.scopes.pop();
        }
    }

    /**
     * Declare a variable in the current scope
     */
    declareVariable(name: string, llvmType: string): Variable {
        const llvmName = `%${name}`;
        const variable: Variable = {
            name,
            llvmName,
            llvmType,
            isPointer: true,  // Stack-allocated variables are pointers
        };

        this.currentScope().set(name, variable);
        return variable;
    }

    /**
     * Look up a variable by name (searches from innermost to outermost scope)
     */
    lookupVariable(name: string): Variable | undefined {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const variable = this.scopes[i].get(name);
            if (variable) {
                return variable;
            }
        }
        return undefined;
    }

    /**
     * Generate a unique temporary register name
     */
    nextTemp(): string {
        return `%t${this.tempCounter++}`;
    }

    /**
     * Generate a unique label for basic blocks (if/else/while)
     */
    nextLabel(prefix: string = "L"): string {
        return `${prefix}${this.labelCounter++}`;
    }

    /**
     * Reset temp counter (useful for new functions)
     */
    resetTemps(): void {
        this.tempCounter = 0;
    }

    /**
     * Reset label counter (useful for new functions)
     */
    resetLabels(): void {
        this.labelCounter = 0;
    }

    /**
     * Get current scope
     */
    private currentScope(): Map<string, Variable> {
        return this.scopes[this.scopes.length - 1];
    }
}
