// Example 12: Generics

interface Box<T> {
    id: number;
    value: T;
}

interface Vector3 {
    x: number;
    y: number;
    z: number;
}

// Example 12: Generics

interface Box<T> {
    id: number;
    value: T;
}

interface Vector3 {
    x: number;
    y: number;
    z: number;
}

function main(): number {
    printf("=== Generics Example ===\n\n");

    let intBox: Box<number> = malloc(sizeof<Box<number>>());
    intBox.id = 1;
    intBox.value = 100;
    printf("Box<number>: id=%d, value=%d\n", intBox.id, intBox.value);
    free(intBox);

    return 0;
}
