import * as ts from 'typescript';



import { GenericInterfaceBlueprint, GenericFunctionBlueprint, GenericRegistry } from "./GenericRegistry";


import { StructRegistry } from "./StructRegistry";


import { Emitter } from "./Emitter";


import { TypeMapper } from "./TypeMapper";


import { TypeResolver, ParsedTypeReference } from "./TypeResolver";



export class Instantiator {

    private genericRegistry: GenericRegistry;

    private structRegistry: StructRegistry;

    private emitter: Emitter;

    private typeResolver: TypeResolver;



    private instantiatedStructs: Set<string> = new Set();

    private instantiatedFunctions: Set<string> = new Set();

    private instantiatingStructs: Set<string> = new Set();



    private resolveTypeFn: (typeNode: ts.TypeNode | undefined) => string;



    constructor(


        genericRegistry: GenericRegistry,

        structRegistry: StructRegistry,

        emitter: Emitter,

        typeResolver: TypeResolver,

        resolveTypeFn: (typeNode: ts.TypeNode | undefined) => string


    ) {

        this.genericRegistry = genericRegistry;

        this.structRegistry = structRegistry;

        this.emitter = emitter;

        this.typeResolver = typeResolver;

        this.resolveTypeFn = resolveTypeFn;

    }
