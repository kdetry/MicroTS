import * as ts from "typescript";

/**
 * GenericInterfaceBlueprint - Stores a generic interface for later instantiation
 */
export interface GenericInterfaceBlueprint {
    name: string;                   // e.g., "Box"
    typeParams: string[];           // e.g., ["T"] or ["T", "U"]
    node: ts.InterfaceDeclaration;  // The AST node
    sourceFile: ts.SourceFile;      // The source file it came from
}

/**
 * GenericFunctionBlueprint - Stores a generic function for later instantiation
 */
export interface GenericFunctionBlueprint {
    name: string;                      // e.g., "set_value"
    typeParams: string[];              // e.g., ["T"]
    node: ts.FunctionDeclaration;      // The AST node
    sourceFile: ts.SourceFile;         // The source file it came from
    associatedStruct?: string;         // Optional: struct name if this is a method
}

/**
 * GenericRegistry - Manages generic blueprints for monomorphization
 * 
 * Stores generic interfaces and functions without compiling them.
 * When a concrete usage is detected (e.g., Box<number>), the instantiator
 * will retrieve the blueprint and generate a concrete version.
 */
export class GenericRegistry {
    private interfaces: Map<string, GenericInterfaceBlueprint> = new Map();
    private functions: Map<string, GenericFunctionBlueprint> = new Map();
    private instantiations: Set<string> = new Set();  // Track what's been instantiated

    /**
     * Register a generic interface blueprint
     */
    registerInterface(
        name: string,
        typeParams: string[],
        node: ts.InterfaceDeclaration,
        sourceFile: ts.SourceFile
    ): void {
        this.interfaces.set(name, {
            name,
            typeParams,
            node,
            sourceFile,
        });
    }

    /**
     * Register a generic function blueprint
     */
    registerFunction(
        name: string,
        typeParams: string[],
        node: ts.FunctionDeclaration,
        sourceFile: ts.SourceFile,
        associatedStruct?: string
    ): void {
        this.functions.set(name, {
            name,
            typeParams,
            node,
            sourceFile,
            associatedStruct,
        });
    }

    /**
     * Get a generic interface blueprint by name
     */
    getInterface(name: string): GenericInterfaceBlueprint | undefined {
        return this.interfaces.get(name);
    }

    /**
     * Get a generic function blueprint by name
     */
    getFunction(name: string): GenericFunctionBlueprint | undefined {
        return this.functions.get(name);
    }

    /**
     * Check if an interface is generic
     */
    isGenericInterface(name: string): boolean {
        return this.interfaces.has(name);
    }

    /**
     * Check if a function is generic
     */
    isGenericFunction(name: string): boolean {
        return this.functions.has(name);
    }

    /**
     * Mark a type instantiation as completed
     */
    markInstantiated(mangledName: string): void {
        this.instantiations.add(mangledName);
    }

    /**
     * Check if a type has been instantiated
     */
    isInstantiated(mangledName: string): boolean {
        return this.instantiations.has(mangledName);
    }

    /**
     * Get all registered generic interfaces
     */
    getAllInterfaces(): GenericInterfaceBlueprint[] {
        return Array.from(this.interfaces.values());
    }

    /**
     * Get all registered generic functions
     */
    getAllFunctions(): GenericFunctionBlueprint[] {
        return Array.from(this.functions.values());
    }

    /**
     * Clear all registries (useful for testing)
     */
    clear(): void {
        this.interfaces.clear();
        this.functions.clear();
        this.instantiations.clear();
    }
}
