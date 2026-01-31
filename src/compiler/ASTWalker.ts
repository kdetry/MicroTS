import * as ts from "typescript";
import { Emitter } from "./Emitter";
import { Context } from "./Context";
import { TypeMapper } from "./TypeMapper";
import { ImportInfo } from "./ModuleResolver";
import { StructRegistry } from "./StructRegistry";

/**
 * ExternFunction - Tracks declared external functions (C FFI)
 */
interface ExternFunction {
    name: string;
    returnType: string;
    params: { name: string; type: string }[];
    isVariadic: boolean;
}

/**
 * InternalFunction - Tracks user-defined functions
 */
interface InternalFunction {
    name: string;
    mangledName: string;    // Name in LLVM IR (e.g., "math_add")
    returnType: string;
    params: { name: string; type: string }[];
}

/**
 * ASTWalker - Traverses TypeScript AST and generates LLVM IR
 * 
 * Phase 1-7: Handles functions, variables, expressions, C FFI, modules, and structs
 */
export class ASTWalker {
    private emitter: Emitter;
    private sourceFile: ts.SourceFile;
    private program: ts.Program;
    private typeChecker: ts.TypeChecker;
    private context: Context;
    private externFunctions: Map<string, ExternFunction> = new Map();
    private internalFunctions: Map<string, InternalFunction> = new Map();

    // Module support
    private currentModule: string = "main";
    private importMap: Map<string, string> = new Map();  // localName → mangledName

    // Struct support
    private structRegistry: StructRegistry = new StructRegistry();

    // Method support (UFCS): structName -> methodName -> function info
    private methodRegistry: Map<string, Map<string, InternalFunction>> = new Map();

    constructor(sourceFile: ts.SourceFile, program: ts.Program, moduleName: string, emitter?: Emitter) {
        this.sourceFile = sourceFile;
        this.program = program;
        this.typeChecker = program.getTypeChecker();
        this.emitter = emitter || new Emitter(moduleName);
        this.context = new Context();
        this.currentModule = moduleName;
    }

    /**
     * Set the shared function registries (for multi-module compilation)
     */
    setSharedRegistries(
        externFunctions: Map<string, ExternFunction>,
        internalFunctions: Map<string, InternalFunction>
    ): void {
        this.externFunctions = externFunctions;
        this.internalFunctions = internalFunctions;
    }

    /**
     * Register imports for symbol resolution
     */
    registerImports(imports: ImportInfo[]): void {
        for (const imp of imports) {
            const mangledName = `${imp.fromModule}_${imp.exportedName}`;
            this.importMap.set(imp.localName, mangledName);
        }
    }

    /**
     * Walk the entire source file and generate LLVM IR
     */
    walk(): string {
        // First pass: collect all interface declarations (structs)
        ts.forEachChild(this.sourceFile, (node) => {
            if (ts.isInterfaceDeclaration(node)) {
                this.visitInterfaceDeclaration(node);
            }
        });

        // Emit struct types to IR
        for (const struct of this.structRegistry.getTopologicalOrder()) {
            const fieldTypes = struct.fields.map(f => f.type);
            this.emitter.addStructType(struct.name, fieldTypes);
        }

        // Second pass: collect all declare statements (external functions)
        ts.forEachChild(this.sourceFile, (node) => {
            if (ts.isFunctionDeclaration(node) && !node.body) {
                // This is a "declare function" - external C function
                this.visitDeclareFunction(node);
            }
        });

        // Third pass: process all function definitions
        ts.forEachChild(this.sourceFile, (node) => {
            if (ts.isFunctionDeclaration(node) && node.body) {
                this.visitFunctionDeclaration(node);
            }
        });

        return this.emitter.getOutput();
    }

    /**
     * Process a declare function (external C function)
     */
    private visitDeclareFunction(node: ts.FunctionDeclaration): void {
        const funcName = node.name?.getText(this.sourceFile);
        if (!funcName) return;

        // Get return type
        const returnType = this.getReturnType(node);
        const llvmReturnType = TypeMapper.mapType(returnType);

        // Get parameters
        const params: { name: string; type: string }[] = [];
        let isVariadic = false;

        for (const param of node.parameters) {
            // Check for rest parameter (...args)
            if (param.dotDotDotToken) {
                isVariadic = true;
                continue;
            }

            const paramName = param.name.getText(this.sourceFile);
            let paramType = "i32";
            if (param.type) {
                paramType = TypeMapper.mapType(param.type.getText(this.sourceFile));
            }
            params.push({ name: paramName, type: paramType });
        }

        // Store extern function info
        this.externFunctions.set(funcName, {
            name: funcName,
            returnType: llvmReturnType,
            params,
            isVariadic,
        });

        // Emit the extern declaration
        const paramTypes = params.map(p => p.type).join(", ");
        this.emitter.addExternFunction(funcName, llvmReturnType, paramTypes, isVariadic);
    }

    /**
     * Process a function declaration
     */
    private visitFunctionDeclaration(node: ts.FunctionDeclaration): void {
        const funcName = node.name?.getText(this.sourceFile);

        if (!funcName) {
            console.warn("Skipping anonymous function");
            return;
        }

        // Reset context for new function
        this.context = new Context();

        // Get return type
        const returnType = this.getReturnType(node);
        const llvmReturnType = TypeMapper.mapType(returnType);

        // Check if first parameter is "this" (method syntax)
        let isMethod = false;
        let structType = "";

        if (node.parameters.length > 0) {
            const firstParam = node.parameters[0];
            const paramName = firstParam.name.getText(this.sourceFile);

            if (paramName === "this" && firstParam.type) {
                isMethod = true;
                structType = firstParam.type.getText(this.sourceFile);
            }
        }

        // Process parameters
        const params: { name: string; type: string }[] = [];
        for (const param of node.parameters) {
            const paramName = param.name.getText(this.sourceFile);
            let paramType = "i32";

            if (param.type) {
                const tsType = param.type.getText(this.sourceFile);
                // For "this" parameter, it's a pointer to the struct
                if (paramName === "this" && this.structRegistry.get(tsType)) {
                    paramType = `%${tsType}*`;
                } else if (this.structRegistry.get(tsType)) {
                    paramType = `%${tsType}*`;
                } else {
                    paramType = TypeMapper.mapType(tsType);
                }
            }
            params.push({ name: paramName, type: paramType });
        }

        // Compute mangled name:
        // - main stays as @main
        // - methods become @StructType_methodName (e.g., @Rect_area)
        // - regular functions become @module_funcName
        let mangledName: string;
        if (funcName === "main") {
            mangledName = "main";
        } else if (isMethod && structType) {
            mangledName = `${structType}_${funcName}`;
        } else {
            mangledName = `${this.currentModule}_${funcName}`;
        }

        // Emit function start with parameters
        const paramStr = params.map(p => `${p.type} %${p.name}.param`).join(", ");
        this.emitter.emitLine(`define ${llvmReturnType} @${mangledName}(${paramStr}) {`);
        this.emitter.emitLine("entry:");

        // Allocate stack space for parameters and store the incoming values
        for (const param of params) {
            const variable = this.context.declareVariable(param.name, param.type);
            this.emitter.emitAlloca(variable.llvmName, param.type);
            this.emitter.emitStore(param.type, `%${param.name}.param`, variable.llvmName);
        }

        // Register function
        const funcInfo: InternalFunction = {
            name: funcName,
            mangledName,
            returnType: llvmReturnType,
            params,
        };

        // Register in appropriate registry
        if (isMethod && structType) {
            // Register as method
            if (!this.methodRegistry.has(structType)) {
                this.methodRegistry.set(structType, new Map());
            }
            this.methodRegistry.get(structType)!.set(funcName, funcInfo);
        }

        // Also register in internalFunctions for direct calls
        this.internalFunctions.set(funcName, funcInfo);

        // Process function body
        if (node.body) {
            this.visitBlock(node.body);
        }

        // For void functions, ensure there's a ret void at the end
        // (in case there's no explicit return statement)
        if (llvmReturnType === "void") {
            this.emitter.emitReturn("void", "");
        }

        // Emit function end
        this.emitter.emitFunctionEnd();
    }

    /**
     * Process an interface declaration (becomes LLVM struct)
     */
    private visitInterfaceDeclaration(node: ts.InterfaceDeclaration): void {
        const interfaceName = node.name.getText(this.sourceFile);

        const fields: { name: string; tsType: string; llvmType: string }[] = [];

        for (const member of node.members) {
            // Only process property signatures
            if (!ts.isPropertySignature(member)) {
                continue;  // Skip methods for now
            }

            // Skip optional properties
            if (member.questionToken) {
                throw new Error(`Optional properties not supported in interface ${interfaceName}`);
            }

            const fieldName = member.name.getText(this.sourceFile);
            let tsType = "number";  // Default
            let llvmType = "i32";   // Default

            if (member.type) {
                tsType = member.type.getText(this.sourceFile);

                // Check if field type is another struct
                if (this.structRegistry.isStruct(tsType)) {
                    llvmType = `%${tsType}*`;  // Pointer to struct
                } else {
                    llvmType = TypeMapper.mapType(tsType);
                }
            }

            fields.push({ name: fieldName, tsType, llvmType });
        }

        // Register the struct
        this.structRegistry.register(interfaceName, fields);
    }

    /**
     * Process a block statement
     */
    private visitBlock(node: ts.Block): void {
        this.context.pushScope();
        for (const statement of node.statements) {
            this.visitStatement(statement);
        }
        this.context.popScope();
    }

    /**
     * Process a statement
     */
    private visitStatement(node: ts.Statement): void {
        if (ts.isReturnStatement(node)) {
            this.visitReturnStatement(node);
        } else if (ts.isVariableStatement(node)) {
            this.visitVariableStatement(node);
        } else if (ts.isExpressionStatement(node)) {
            this.visitExpression(node.expression);
        } else if (ts.isIfStatement(node)) {
            this.visitIfStatement(node);
        } else if (ts.isWhileStatement(node)) {
            this.visitWhileStatement(node);
        } else if (ts.isForStatement(node)) {
            this.visitForStatement(node);
        } else if (ts.isBlock(node)) {
            this.visitBlock(node);
        }
    }

    /**
     * Process a variable statement (let x = 5;)
     */
    private visitVariableStatement(node: ts.VariableStatement): void {
        for (const decl of node.declarationList.declarations) {
            this.visitVariableDeclaration(decl);
        }
    }

    /**
     * Process a single variable declaration
     */
    private visitVariableDeclaration(node: ts.VariableDeclaration): void {
        const name = node.name.getText(this.sourceFile);

        // Determine type
        let llvmType = "i32";  // Default
        let isStructType = false;
        let structTypeName = "";

        if (node.type) {
            const tsType = node.type.getText(this.sourceFile);

            // Check if this is a struct type
            if (this.structRegistry.get(tsType)) {
                isStructType = true;
                structTypeName = tsType;
                llvmType = `%${tsType}*`;  // Struct variables are pointers
            } else {
                llvmType = TypeMapper.mapType(tsType);
            }
        }

        // Declare variable in context
        const variable = this.context.declareVariable(name, llvmType);

        // Emit alloca for stack allocation
        this.emitter.emitAlloca(variable.llvmName, llvmType);

        // If there's an initializer, store the value
        if (node.initializer) {
            const value = this.visitExpression(node.initializer);

            // If struct type and initializer is from malloc (i8*), bitcast it
            if (isStructType) {
                const castedPtr = this.context.nextTemp();
                this.emitter.emitBitcast(castedPtr, "i8*", value, `%${structTypeName}*`);
                this.emitter.emitStore(llvmType, castedPtr, variable.llvmName);
            } else {
                this.emitter.emitStore(llvmType, value, variable.llvmName);
            }
        }
    }

    /**
     * Process a return statement
     */
    private visitReturnStatement(node: ts.ReturnStatement): void {
        if (node.expression) {
            const value = this.visitExpression(node.expression);
            // For now, assume i32 return type
            this.emitter.emitReturn("i32", value);
        } else {
            this.emitter.emitReturn("void", "");
        }
    }

    /**
     * Process an if statement
     * 
     * Generates:
     *   %cond = <condition>
     *   br i1 %cond, label %then, label %else
     * then:
     *   <then body>
     *   br label %endif
     * else:
     *   <else body>
     *   br label %endif
     * endif:
     */
    private visitIfStatement(node: ts.IfStatement): void {
        const thenLabel = this.context.nextLabel("if.then");
        const elseLabel = this.context.nextLabel("if.else");
        const endLabel = this.context.nextLabel("if.end");

        // Evaluate condition
        const condition = this.visitExpression(node.expression);

        // Convert to i1 if needed (compare with 0)
        const condReg = this.ensureBooleanCondition(condition);

        if (node.elseStatement) {
            // Branch based on condition
            this.emitter.emitConditionalBranch(condReg, thenLabel, elseLabel);

            // Then block
            this.emitter.emitLabel(thenLabel);
            this.visitStatement(node.thenStatement);
            this.emitter.emitBranch(endLabel);

            // Else block
            this.emitter.emitLabel(elseLabel);
            this.visitStatement(node.elseStatement);
            this.emitter.emitBranch(endLabel);
        } else {
            // No else block
            this.emitter.emitConditionalBranch(condReg, thenLabel, endLabel);

            // Then block
            this.emitter.emitLabel(thenLabel);
            this.visitStatement(node.thenStatement);
            this.emitter.emitBranch(endLabel);
        }

        // End label (continuation)
        this.emitter.emitLabel(endLabel);
    }

    /**
     * Process a while statement
     * 
     * Generates:
     *   br label %while.cond
     * while.cond:
     *   %cond = <condition>
     *   br i1 %cond, label %while.body, label %while.end
     * while.body:
     *   <body>
     *   br label %while.cond
     * while.end:
     */
    private visitWhileStatement(node: ts.WhileStatement): void {
        const condLabel = this.context.nextLabel("while.cond");
        const bodyLabel = this.context.nextLabel("while.body");
        const endLabel = this.context.nextLabel("while.end");

        // Jump to condition check
        this.emitter.emitBranch(condLabel);

        // Condition block
        this.emitter.emitLabel(condLabel);
        const condition = this.visitExpression(node.expression);
        const condReg = this.ensureBooleanCondition(condition);
        this.emitter.emitConditionalBranch(condReg, bodyLabel, endLabel);

        // Body block
        this.emitter.emitLabel(bodyLabel);
        this.visitStatement(node.statement);
        this.emitter.emitBranch(condLabel);

        // End label
        this.emitter.emitLabel(endLabel);
    }

    /**
     * Process a for statement (lower to while)
     * 
     * for (init; cond; update) { body }
     * becomes:
     *   init
     *   while (cond) { body; update; }
     */
    private visitForStatement(node: ts.ForStatement): void {
        // Process initializer
        if (node.initializer) {
            if (ts.isVariableDeclarationList(node.initializer)) {
                for (const decl of node.initializer.declarations) {
                    this.visitVariableDeclaration(decl);
                }
            } else {
                this.visitExpression(node.initializer);
            }
        }

        const condLabel = this.context.nextLabel("for.cond");
        const bodyLabel = this.context.nextLabel("for.body");
        const endLabel = this.context.nextLabel("for.end");

        // Jump to condition check
        this.emitter.emitBranch(condLabel);

        // Condition block
        this.emitter.emitLabel(condLabel);
        if (node.condition) {
            const condition = this.visitExpression(node.condition);
            const condReg = this.ensureBooleanCondition(condition);
            this.emitter.emitConditionalBranch(condReg, bodyLabel, endLabel);
        } else {
            // No condition = infinite loop (true)
            this.emitter.emitBranch(bodyLabel);
        }

        // Body block
        this.emitter.emitLabel(bodyLabel);
        this.visitStatement(node.statement);

        // Incrementer
        if (node.incrementor) {
            this.visitExpression(node.incrementor);
        }
        this.emitter.emitBranch(condLabel);

        // End label
        this.emitter.emitLabel(endLabel);
    }

    /**
     * Ensure a value is an i1 boolean (for branch conditions)
     */
    private ensureBooleanCondition(value: string): string {
        // If the value is already a comparison result (i1), use it directly
        // Otherwise, compare with 0 to get a boolean
        // For simplicity, we'll assume comparisons return i1 and other values need comparison

        // Check if it's a numeric literal
        if (/^-?\d+$/.test(value)) {
            const resultReg = this.context.nextTemp();
            this.emitter.emitLine(`${resultReg} = icmp ne i32 ${value}, 0`);
            return resultReg;
        }

        // For register values, assume they might need conversion
        // In a more complete implementation, we'd track types
        return value;
    }

    /**
     * Process an expression and return its LLVM representation (value or register)
     */
    private visitExpression(node: ts.Expression): string {
        if (ts.isNumericLiteral(node)) {
            return node.getText(this.sourceFile);
        }

        if (ts.isParenthesizedExpression(node)) {
            return this.visitExpression(node.expression);
        }

        if (ts.isIdentifier(node)) {
            return this.visitIdentifier(node);
        }

        if (ts.isBinaryExpression(node)) {
            return this.visitBinaryExpression(node);
        }

        if (ts.isPrefixUnaryExpression(node)) {
            return this.visitPrefixUnaryExpression(node);
        }

        if (ts.isCallExpression(node)) {
            return this.visitCallExpression(node);
        }

        if (ts.isStringLiteral(node)) {
            return this.visitStringLiteral(node);
        }

        if (ts.isPropertyAccessExpression(node)) {
            return this.visitPropertyAccessExpression(node);
        }

        if (ts.isElementAccessExpression(node)) {
            return this.visitElementAccessExpression(node);
        }

        throw new Error(`Unsupported expression type: ${ts.SyntaxKind[node.kind]}`);
    }

    /**
     * Process a function call expression
     */
    private visitCallExpression(node: ts.CallExpression): string {
        const funcExpr = node.expression;

        // Handle method calls: obj.method(args)
        if (ts.isPropertyAccessExpression(funcExpr)) {
            return this.visitMethodCallExpression(node, funcExpr);
        }

        // Regular function call: funcName(args)
        if (!ts.isIdentifier(funcExpr)) {
            throw new Error("Only direct function calls or method calls are supported");
        }

        const funcName = funcExpr.getText(this.sourceFile);

        // Handle sizeof<T>() intrinsic
        if (funcName === "sizeof" && node.typeArguments && node.typeArguments.length > 0) {
            const typeArg = node.typeArguments[0];
            const typeName = typeArg.getText(this.sourceFile);
            const struct = this.structRegistry.get(typeName);

            if (!struct) {
                throw new Error(`sizeof: Unknown type '${typeName}'`);
            }

            // Return the struct size as a constant
            return struct.size.toString();
        }

        // Resolve the function: check importMap, then internal, then external
        let resolvedName: string;
        let funcInfo: ExternFunction | InternalFunction | undefined;
        let isVariadic = false;

        // 1. Check if this was imported from another module
        if (this.importMap.has(funcName)) {
            resolvedName = this.importMap.get(funcName)!;
            // Find the function info by checking all internal functions
            for (const [, func] of this.internalFunctions) {
                if (func.mangledName === resolvedName) {
                    funcInfo = func;
                    break;
                }
            }
        }
        // 2. Check internal functions (local to this module)
        else if (this.internalFunctions.has(funcName)) {
            funcInfo = this.internalFunctions.get(funcName);
            resolvedName = (funcInfo as InternalFunction).mangledName;
        }
        // 3. Check external functions (C FFI)
        else if (this.externFunctions.has(funcName)) {
            funcInfo = this.externFunctions.get(funcName);
            resolvedName = funcName;  // External functions keep their original name
            isVariadic = (funcInfo as ExternFunction).isVariadic;
        }
        // 4. Not found
        else {
            throw new Error(`Unknown function: ${funcName}`);
        }

        if (!funcInfo) {
            throw new Error(`Could not resolve function info for: ${funcName} (resolved to ${resolvedName})`);
        }

        // Process arguments
        const args: string[] = [];

        for (let i = 0; i < node.arguments.length; i++) {
            const arg = node.arguments[i];
            const value = this.visitExpression(arg);

            // Determine argument type
            let argType = "i32";  // Default
            if (i < funcInfo.params.length) {
                argType = funcInfo.params[i].type;
            } else if (ts.isStringLiteral(arg)) {
                argType = "i8*";
            }

            args.push(`${argType} ${value}`);
        }

        const argsStr = args.join(", ");
        const resultReg = this.context.nextTemp();

        // Emit the call with the resolved/mangled name
        if (isVariadic) {
            this.emitter.emitVariadicCall(
                funcInfo.returnType !== "void" ? resultReg : null,
                funcInfo.returnType,
                resolvedName,
                argsStr
            );
        } else {
            this.emitter.emitCall(
                funcInfo.returnType !== "void" ? resultReg : null,
                funcInfo.returnType,
                resolvedName,
                argsStr
            );
        }

        return funcInfo.returnType !== "void" ? resultReg : "0";
    }

    /**
     * Process a method call expression: obj.method(args)
     * Implements UFCS: rewrites to method(obj, args)
     */
    private visitMethodCallExpression(
        node: ts.CallExpression,
        funcExpr: ts.PropertyAccessExpression
    ): string {
        const objExpr = funcExpr.expression;
        const methodName = funcExpr.name.getText(this.sourceFile);

        // Get the object's type by looking up the variable
        if (!ts.isIdentifier(objExpr)) {
            throw new Error("Method calls only supported on direct identifiers");
        }

        const objName = objExpr.getText(this.sourceFile);
        const variable = this.context.lookupVariable(objName);

        if (!variable) {
            throw new Error(`Undefined variable: ${objName}`);
        }

        // Extract struct type from variable type (e.g., "%Rect*" -> "Rect")
        const structType = variable.llvmType.replace(/^\%/, "").replace(/\*$/, "");

        // Look up the method in methodRegistry
        const methods = this.methodRegistry.get(structType);
        if (!methods || !methods.has(methodName)) {
            throw new Error(`Unknown method '${methodName}' for type '${structType}'`);
        }

        const methodInfo = methods.get(methodName)!;

        // Get the object pointer (this will be the first argument)
        const objAddr = this.getStorageAddress(objExpr);

        // Build arguments: first arg is the object pointer (this)
        const args: string[] = [];

        // First argument: the object pointer
        const ptrType = objAddr.type.startsWith("%") ? `${objAddr.type}*` : `%${objAddr.type}*`;
        args.push(`${ptrType} ${objAddr.ptr}`);

        // Process remaining arguments
        for (let i = 0; i < node.arguments.length; i++) {
            const arg = node.arguments[i];
            const value = this.visitExpression(arg);

            // Get arg type from method params (offset by 1 for 'this')
            let argType = "i32";
            if (i + 1 < methodInfo.params.length) {
                argType = methodInfo.params[i + 1].type;
            }
            args.push(`${argType} ${value}`);
        }

        const argsStr = args.join(", ");
        const resultReg = methodInfo.returnType !== "void"
            ? this.context.nextTemp()
            : null;

        // Emit the call
        this.emitter.emitCall(resultReg, methodInfo.returnType, methodInfo.mangledName, argsStr);

        return resultReg ?? "0";
    }

    /**
     * Process a string literal
     */
    private visitStringLiteral(node: ts.StringLiteral): string {
        // Get the string value (without quotes)
        const value = node.text;

        // Add to string constants and get the global name
        const { name, length } = this.emitter.addStringConstant(value);

        // Generate a getelementptr to get the i8* pointer
        const resultReg = this.context.nextTemp();
        this.emitter.emitGetElementPtr(
            resultReg,
            `[${length} x i8]`,
            `[${length} x i8]*`,
            name,
            "i32 0, i32 0"
        );

        return resultReg;
    }

    /**
     * Get the storage address (L-value) of an expression
     * Handles nested struct access recursively: line.start.x
     * 
     * Returns { ptr: LLVM register pointing to the value, type: LLVM type of the value }
     */
    private getStorageAddress(node: ts.Expression): { ptr: string; type: string } {
        // CASE A: Variable identifier (base case)
        if (ts.isIdentifier(node)) {
            const name = node.getText(this.sourceFile);
            const variable = this.context.lookupVariable(name);

            if (!variable) {
                throw new Error(`Undefined variable: ${name}`);
            }

            // Load the pointer from the stack variable
            const loadedPtr = this.context.nextTemp();
            this.emitter.emitLoad(loadedPtr, variable.llvmType, variable.llvmName);

            // Return the pointer and the base type (without trailing *)
            const baseType = variable.llvmType.replace(/\*$/, "");
            return { ptr: loadedPtr, type: baseType };
        }

        // CASE A2: "this" keyword (for method context)
        if (node.kind === ts.SyntaxKind.ThisKeyword) {
            const variable = this.context.lookupVariable("this");

            if (!variable) {
                throw new Error(`'this' used outside of method context`);
            }

            // Load the pointer from the stack variable
            const loadedPtr = this.context.nextTemp();
            this.emitter.emitLoad(loadedPtr, variable.llvmType, variable.llvmName);

            // Return the pointer and the base type (without trailing *)
            const baseType = variable.llvmType.replace(/\*$/, "");
            return { ptr: loadedPtr, type: baseType };
        }

        // CASE B: Property access (recursive case): obj.field or obj.nested.field
        if (ts.isPropertyAccessExpression(node)) {
            // 1. Recursively get the parent's storage address
            const parent = this.getStorageAddress(node.expression);

            // 2. Get struct type name (e.g., "%Point" -> "Point")
            const structType = parent.type.replace(/^\%/, "");
            const fieldName = node.name.getText(this.sourceFile);

            // 3. Look up the struct definition
            const structDef = this.structRegistry.get(structType);
            if (!structDef) {
                throw new Error(`Unknown struct type: ${structType}`);
            }

            // 4. Find the field
            const field = structDef.fields.find(f => f.name === fieldName);
            if (!field) {
                throw new Error(`Unknown field '${fieldName}' in struct '${structType}'`);
            }

            // 5. GEP to calculate field address
            const fieldPtr = this.context.nextTemp();
            const parentPtrType = parent.type.startsWith("%") ? `${parent.type}*` : `%${parent.type}*`;
            this.emitter.emitLine(`${fieldPtr} = getelementptr %${structType}, ${parentPtrType} ${parent.ptr}, i32 0, i32 ${field.index}`);

            // 6. Return the field pointer and its type (without trailing *)
            const fieldBaseType = field.type.replace(/\*$/, "");
            return { ptr: fieldPtr, type: fieldBaseType };
        }

        throw new Error(`Cannot get storage address for: ${ts.SyntaxKind[node.kind]}`);
    }

    /**
     * Process a property access expression (obj.field or obj.nested.field)
     * Used for reading struct fields - supports nested access
     */
    private visitPropertyAccessExpression(node: ts.PropertyAccessExpression): string {
        // Get the storage address using recursive helper
        const addr = this.getStorageAddress(node);

        // Load the value from that address
        const result = this.context.nextTemp();
        const ptrType = addr.type.endsWith("*") ? addr.type : `${addr.type}*`;
        this.emitter.emitLine(`${result} = load ${addr.type}, ${ptrType} ${addr.ptr}`);

        return result;
    }

    /**
     * Process an element access expression (array[index])
     * 
     * For reading: arr[i] loads the value at that index
     * Uses getelementptr to compute the address, then load
     */
    private visitElementAccessExpression(node: ts.ElementAccessExpression): string {
        // Get the array base pointer
        const arrayExpr = node.expression;
        let basePtr: string;
        let baseType = "i32";  // Default element type

        if (ts.isIdentifier(arrayExpr)) {
            const name = arrayExpr.getText(this.sourceFile);
            const variable = this.context.lookupVariable(name);
            if (!variable) {
                throw new Error(`Undefined variable: ${name}`);
            }
            // Load the pointer value from the variable
            basePtr = this.context.nextTemp();
            this.emitter.emitLoad(basePtr, variable.llvmType, variable.llvmName);

            // Extract element type from pointer type (e.g., "i32*" -> "i32")
            if (variable.llvmType.endsWith("*")) {
                baseType = variable.llvmType.slice(0, -1);
            }
        } else {
            basePtr = this.visitExpression(arrayExpr);
        }

        // Get the index
        if (!node.argumentExpression) {
            throw new Error("Array access requires an index");
        }
        const index = this.visitExpression(node.argumentExpression);

        // Compute element address using getelementptr
        const elemPtr = this.context.nextTemp();
        this.emitter.emitLine(`${elemPtr} = getelementptr ${baseType}, ${baseType}* ${basePtr}, i32 ${index}`);

        // Load the value at that address
        const resultReg = this.context.nextTemp();
        this.emitter.emitLoad(resultReg, baseType, elemPtr);

        return resultReg;
    }

    /**
     * Get the element pointer for an array access (for assignment)
     */
    private getElementPointer(node: ts.ElementAccessExpression): { ptr: string; type: string } {
        const arrayExpr = node.expression;
        let basePtr: string;
        let baseType = "i32";

        if (ts.isIdentifier(arrayExpr)) {
            const name = arrayExpr.getText(this.sourceFile);
            const variable = this.context.lookupVariable(name);
            if (!variable) {
                throw new Error(`Undefined variable: ${name}`);
            }
            basePtr = this.context.nextTemp();
            this.emitter.emitLoad(basePtr, variable.llvmType, variable.llvmName);

            if (variable.llvmType.endsWith("*")) {
                baseType = variable.llvmType.slice(0, -1);
            }
        } else {
            basePtr = this.visitExpression(arrayExpr);
        }

        if (!node.argumentExpression) {
            throw new Error("Array access requires an index");
        }
        const index = this.visitExpression(node.argumentExpression);

        const elemPtr = this.context.nextTemp();
        this.emitter.emitLine(`${elemPtr} = getelementptr ${baseType}, ${baseType}* ${basePtr}, i32 ${index}`);

        return { ptr: elemPtr, type: baseType };
    }


    /**
     * Process an identifier (variable reference)
     */
    private visitIdentifier(node: ts.Identifier): string {
        const name = node.getText(this.sourceFile);
        const variable = this.context.lookupVariable(name);

        if (!variable) {
            throw new Error(`Undefined variable: ${name}`);
        }

        // Load the value from the stack-allocated variable
        const tempReg = this.context.nextTemp();
        this.emitter.emitLoad(tempReg, variable.llvmType, variable.llvmName);
        return tempReg;
    }

    /**
     * Process a binary expression (a + b, x * y, etc.)
     */
    private visitBinaryExpression(node: ts.BinaryExpression): string {
        const left = this.visitExpression(node.left);
        const right = this.visitExpression(node.right);

        const operatorToken = node.operatorToken.kind;
        const resultReg = this.context.nextTemp();

        // Determine type (for now, default to i32)
        const llvmType = "i32";

        // Handle assignment
        if (operatorToken === ts.SyntaxKind.EqualsToken) {
            return this.visitAssignment(node);
        }

        // Handle arithmetic operators
        const op = this.getOperatorString(operatorToken);

        if (this.isComparisonOperator(operatorToken)) {
            const { instruction, predicate } = TypeMapper.getCompareOp(op, llvmType);
            this.emitter.emitLine(`${resultReg} = ${instruction} ${predicate} ${llvmType} ${left}, ${right}`);
        } else {
            const llvmOp = TypeMapper.getBinaryOp(op, llvmType);
            this.emitter.emitBinaryOp(resultReg, llvmOp, llvmType, left, right);
        }

        return resultReg;
    }

    /**
     * Process an assignment expression
     */
    private visitAssignment(node: ts.BinaryExpression): string {
        const value = this.visitExpression(node.right);

        // Handle array element assignment: arr[i] = value
        if (ts.isElementAccessExpression(node.left)) {
            const { ptr, type } = this.getElementPointer(node.left);
            this.emitter.emitStore(type, value, ptr);
            return value;
        }

        // Handle struct field assignment: obj.field = value (supports nesting)
        if (ts.isPropertyAccessExpression(node.left)) {
            // Use the recursive getStorageAddress helper
            const addr = this.getStorageAddress(node.left);
            const ptrType = addr.type.endsWith("*") ? addr.type : `${addr.type}*`;
            this.emitter.emitLine(`store ${addr.type} ${value}, ${ptrType} ${addr.ptr}`);
            return value;
        }

        // Handle identifier assignment: x = value
        if (ts.isIdentifier(node.left)) {
            const name = node.left.getText(this.sourceFile);
            const variable = this.context.lookupVariable(name);

            if (!variable) {
                throw new Error(`Undefined variable: ${name}`);
            }

            this.emitter.emitStore(variable.llvmType, value, variable.llvmName);
            return value;
        }

        throw new Error("Assignment target must be an identifier, array element, or struct field");
    }

    /**
     * Process a prefix unary expression (-x, !x)
     */
    private visitPrefixUnaryExpression(node: ts.PrefixUnaryExpression): string {
        const operand = this.visitExpression(node.operand);
        const resultReg = this.context.nextTemp();

        switch (node.operator) {
            case ts.SyntaxKind.MinusToken:
                // Negate: 0 - x
                this.emitter.emitBinaryOp(resultReg, "sub", "i32", "0", operand);
                return resultReg;
            case ts.SyntaxKind.ExclamationToken:
                // Logical not: x == 0
                this.emitter.emitLine(`${resultReg} = icmp eq i32 ${operand}, 0`);
                return resultReg;
            default:
                throw new Error(`Unsupported prefix operator: ${ts.SyntaxKind[node.operator]}`);
        }
    }

    /**
     * Get the string representation of an operator
     */
    private getOperatorString(kind: ts.SyntaxKind): string {
        switch (kind) {
            case ts.SyntaxKind.PlusToken: return "+";
            case ts.SyntaxKind.MinusToken: return "-";
            case ts.SyntaxKind.AsteriskToken: return "*";
            case ts.SyntaxKind.SlashToken: return "/";
            case ts.SyntaxKind.PercentToken: return "%";
            case ts.SyntaxKind.LessThanToken: return "<";
            case ts.SyntaxKind.GreaterThanToken: return ">";
            case ts.SyntaxKind.LessThanEqualsToken: return "<=";
            case ts.SyntaxKind.GreaterThanEqualsToken: return ">=";
            case ts.SyntaxKind.EqualsEqualsToken: return "==";
            case ts.SyntaxKind.EqualsEqualsEqualsToken: return "===";
            case ts.SyntaxKind.ExclamationEqualsToken: return "!=";
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: return "!==";
            default:
                throw new Error(`Unknown operator: ${ts.SyntaxKind[kind]}`);
        }
    }

    /**
     * Check if an operator is a comparison operator
     */
    private isComparisonOperator(kind: ts.SyntaxKind): boolean {
        return [
            ts.SyntaxKind.LessThanToken,
            ts.SyntaxKind.GreaterThanToken,
            ts.SyntaxKind.LessThanEqualsToken,
            ts.SyntaxKind.GreaterThanEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(kind);
    }

    /**
     * Get the return type of a function
     */
    private getReturnType(node: ts.FunctionDeclaration): string {
        if (node.type) {
            return node.type.getText(this.sourceFile);
        }

        // Try to infer from type checker
        const signature = this.typeChecker.getSignatureFromDeclaration(node);
        if (signature) {
            const returnType = this.typeChecker.getReturnTypeOfSignature(signature);
            return this.typeChecker.typeToString(returnType);
        }

        return "void";
    }

    /**
     * Load stdlib declarations from a prelude file (e.g., libc.ts)
     * This allows users to use printf, malloc, etc. without declaring them
     * Also supports multifile: loads function definitions from sibling files
     */
    loadPrelude(preludePath: string): void {
        const fs = require("fs");

        if (!fs.existsSync(preludePath)) {
            return;  // No prelude file, skip silently
        }

        // Parse the prelude file
        const preludeProgram = ts.createProgram([preludePath], {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            strict: false,
            skipLibCheck: true,
            skipDefaultLibCheck: true,
        });

        const preludeSource = preludeProgram.getSourceFile(preludePath);
        if (!preludeSource) {
            return;
        }

        // Save original source file reference
        const originalSource = this.sourceFile;

        // Process all functions from the prelude
        ts.forEachChild(preludeSource, (node) => {
            if (ts.isFunctionDeclaration(node)) {
                if (!node.body) {
                    // External declaration (declare function)
                    this.visitDeclareFunctionFromSource(node, preludeSource);
                } else {
                    // Function with body - compile it
                    this.sourceFile = preludeSource;
                    this.visitFunctionDeclaration(node);
                }
            }
        });

        // Restore original source file
        this.sourceFile = originalSource;
    }

    /**
     * Process a declare function from a different source file
     */
    private visitDeclareFunctionFromSource(node: ts.FunctionDeclaration, source: ts.SourceFile): void {
        const funcName = node.name?.getText(source);
        if (!funcName) return;

        // Get return type
        let returnType = "number";
        if (node.type) {
            returnType = node.type.getText(source);
        }
        const llvmReturnType = TypeMapper.mapType(returnType);

        // Get parameters
        const params: { name: string; type: string }[] = [];
        let isVariadic = false;

        for (const param of node.parameters) {
            if (param.dotDotDotToken) {
                isVariadic = true;
                continue;
            }

            const paramName = param.name.getText(source);
            let paramType = "i32";
            if (param.type) {
                paramType = TypeMapper.mapType(param.type.getText(source));
            }
            params.push({ name: paramName, type: paramType });
        }

        // Store extern function info
        this.externFunctions.set(funcName, {
            name: funcName,
            returnType: llvmReturnType,
            params,
            isVariadic,
        });

        // Emit the extern declaration
        const paramTypes = params.map(p => p.type).join(", ");
        this.emitter.addExternFunction(funcName, llvmReturnType, paramTypes, isVariadic);
    }
}

/**
 * Compile a TypeScript source file to LLVM IR
 * Supports ES module imports - resolves dependencies and compiles all into one .ll file
 */
export function compileToIR(sourceFilePath: string): string {
    const fs = require("fs");
    const path = require("path");
    const { ModuleResolver } = require("./ModuleResolver");

    // Check if the file has imports
    const sourceContent = fs.readFileSync(sourceFilePath, "utf-8");
    const hasImports = sourceContent.includes("import ");

    if (hasImports) {
        // Use ModuleResolver for import-based multi-module compilation
        return compileWithModules(sourceFilePath);
    } else {
        // Legacy single-file + sibling compilation (backward compatible)
        return compileSingleFile(sourceFilePath);
    }
}

/**
 * Compile with proper ES module import support
 */
function compileWithModules(entryPath: string): string {
    const path = require("path");
    const { ModuleResolver } = require("./ModuleResolver");

    // Resolve all dependencies
    const resolver = new ModuleResolver(entryPath);
    const modules = resolver.resolve();

    // Create shared emitter and registries
    const emitter = new Emitter("program");
    const externFunctions = new Map();
    const internalFunctions = new Map();

    // Load stdlib prelude first
    const libcPath = path.join(__dirname, "../stdlib/libc.ts");
    const preludeWalker = new ASTWalker(modules[0].sourceFile, modules[0].program, "stdlib", emitter);
    preludeWalker.setSharedRegistries(externFunctions, internalFunctions);
    preludeWalker.loadPrelude(libcPath);

    // Process each module in dependency order
    for (const mod of modules) {
        const walker = new ASTWalker(mod.sourceFile, mod.program, mod.name, emitter);
        walker.setSharedRegistries(externFunctions, internalFunctions);
        walker.registerImports(mod.imports);
        walker.walk();
    }

    return emitter.getOutput();
}

/**
 * Legacy single-file compilation (for files without imports)
 */
function compileSingleFile(sourceFilePath: string): string {
    const fs = require("fs");
    const path = require("path");

    // Create a program with just this file
    const program = ts.createProgram([sourceFilePath], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: false,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
    });

    const sourceFile = program.getSourceFile(sourceFilePath);

    if (!sourceFile) {
        throw new Error(`Could not load source file: ${sourceFilePath}`);
    }

    // Check for syntax errors
    const syntaxDiagnostics = program.getSyntacticDiagnostics(sourceFile);
    if (syntaxDiagnostics.length > 0) {
        const messages = syntaxDiagnostics.map((d) => {
            const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
            if (d.file && d.start !== undefined) {
                const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
                return `${d.file.fileName}:${line + 1}:${character + 1}: ${message}`;
            }
            return message;
        });
        throw new Error(`Syntax errors:\n${messages.join("\n")}`);
    }

    const moduleName = sourceFilePath.split("/").pop()?.replace(".ts", "") || "module";
    const walker = new ASTWalker(sourceFile, program, moduleName);

    // Load stdlib prelude
    const libcPath = path.join(__dirname, "../stdlib/libc.ts");
    walker.loadPrelude(libcPath);

    // Load sibling files (legacy behavior)
    const sourceDir = path.dirname(sourceFilePath);
    const sourceBasename = path.basename(sourceFilePath);
    const siblingFiles = fs.readdirSync(sourceDir)
        .filter((f: string) => f.endsWith(".ts") && f !== sourceBasename)
        .sort();

    for (const sibling of siblingFiles) {
        const siblingPath = path.join(sourceDir, sibling);
        walker.loadPrelude(siblingPath);
    }

    return walker.walk();
}

