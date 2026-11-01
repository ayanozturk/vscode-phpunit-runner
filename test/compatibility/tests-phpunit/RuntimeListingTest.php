<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

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
}
