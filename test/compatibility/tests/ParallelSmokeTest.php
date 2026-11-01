<?php

declare(strict_types=1);

it('runs a passing smoke assertion', function (): void {
    expect(2 + 2)->toBe(4);
});

it('runs another test in parallel', function (): void {
    expect('php')->toBeString();
});
