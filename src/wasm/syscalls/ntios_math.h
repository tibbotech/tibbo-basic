/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_MATH_H_
#define SYSCALLS_NTIOS_MATH_H_

#include "base/ntios_types.h"

#include <string>

namespace ntios {
namespace math {
    float acos(float x);
    float cos(float angle);

    float asin(float x);
    float sin(float angle);

    float atan(float x);
    float tan(float angle);
    float atan2(float x, float y);

    char cfloat(const float num);

    float sqrt(float x);

}  // namespace math
}  // namespace ntios

#endif  // SYSCALLS_NTIOS_MATH_H_
