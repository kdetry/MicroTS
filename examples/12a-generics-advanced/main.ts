// Advanced generics test

interface Box<T> {
    id: number;
    value: T;
}

interface Pair<T, U> {
    first: T;
    second: U;
}

function main(): number {
    printf("=== Advanced Generics Test ===\n\n");

    // Test 1: Basic generic - Box<number>
    printf("Test 1: Box<number>\n");
    let intBox: Box<number> = malloc(sizeof<Box<number>>());
    intBox.id = 1;
    intBox.value = 100;
    printf("  id=%d, value=%d\n", intBox.id, intBox.value);
    free(intBox);

    // Test 2: Same generic, different instantiation - Box<number> again
    // Should reuse the same mangled name
    printf("\nTest 2: Another Box<number>\n");
    let intBox2: Box<number> = malloc(sizeof<Box<number>>());
    intBox2.id = 2;
    intBox2.value = 200;
    printf("  id=%d, value=%d\n", intBox2.id, intBox2.value);
    free(intBox2);

    // Test 3: Multiple type parameters - Pair<number, number>
    printf("\nTest 3: Pair<number, number>\n");
    let numPair: Pair<number, number> = malloc(sizeof<Pair<number, number>>());
    numPair.first = 10;
    numPair.second = 20;
    printf("  first=%d, second=%d\n", numPair.first, numPair.second);
    free(numPair);

    return 0;
}
