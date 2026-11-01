<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use CompatibilityFixture\Calculator;

require_once __DIR__ . '/../src/Calculator.php';

final class RuntimeListingTest extends TestCase
{
    /** @return iterable<string, array{int}> */
    public static function values(): iterable
    {
        yield 'first case' => [1];
        yield 'second case' => [2];
    }

    #[DataProvider('values')]
    public function testRuntimeListing(int $value): void
    {
        self::assertGreaterThan(0, $value);
    }

    public function testCoverageJsonlMapping(): void
    {
        self::assertSame(6, Calculator::double(3));
    }
}
