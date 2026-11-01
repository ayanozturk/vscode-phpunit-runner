<?php

declare(strict_types=1);

namespace CompatibilityFixture;

final class Calculator
{
    public static function double(int $value): int
    {
        return $value * 2;
    }
}
