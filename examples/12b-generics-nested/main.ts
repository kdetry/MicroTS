// Test nested generics

interface Box<T> {
    id: number;
    value: T;
}

function main(): number {
    printf("=== Nested Generics Test ===\n\n");

    // Test: Box<Box<number>>
    // A box containing another box
    let nestedBox: Box<Box<number>> = malloc(sizeof<Box<Box<number>>>());
    nestedBox.id = 1;

    // Allocate inner box
    nestedBox.value = malloc(sizeof<Box<number>>());
    nestedBox.value.id = 2;
    nestedBox.value.value = 100;

    printf("Nested Box:\n");
    printf("  outer.id = %d\n", nestedBox.id);
    printf("  inner.id = %d\n", nestedBox.value.id);
    printf("  inner.value = %d\n", nestedBox.value.value);

    // Clean up commented out for testing
    // free(nestedBox.value);
    // free(nestedBox);

    return 0;
}
