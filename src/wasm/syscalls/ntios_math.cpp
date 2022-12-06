/*Copyright 2021 Tibbo Technology Inc.*/

// INCLUDES
#include <cmath>
#include <string>
#include <sstream>

#include "syscalls/ntios_math.h"
#include "base/ntios_types.h"

// MACROS
#define TB_PI 3.141592653589793238462643383279502884197f

// CONSTANTS
const float ANGLE180 = 180;



// NAMESPACE
namespace ntios {
namespace math {
    /* PRIVATE */

    /* PUBLIC */
    float acos(float x) {
        /*
        * Method:
        *   Calculates the arc-cos in degrees.
        * Input:
        *   x: floating point value.
        */
        float r = std::acos(x);
        return (r * ANGLE180 / TB_PI);
    }
    float cos(float angle) {
        /*
        * Method:
        *   Calculates the cos of a specified angle.
        * Input:
        *   angle: angle in degrees.
        */
        float r = (angle * TB_PI / ANGLE180);
        return (std::cos(r));
    }

    float asin(float x) {
        /*
        * Method:
        *   Calculates the arc-sin in degrees.
        * Input:
        *   x: floating point value.
        */
        float r = std::asin(x);
        return (r * ANGLE180 / TB_PI);
    }
    float sin(float angle) {
        /*
        * Method:
        *   Calculates the sin of a specified angle.
        * Input:
        *   angle: angle in degrees.
        */
        float r = (angle * TB_PI / ANGLE180);
        return (std::sin(r));
    }

    float atan(float x) {
        /*
        * Method:
        *   Calculates the arc-tan in degrees.
        * Input:
        *   x: floating point value.
        */
        float r = std::atan(x);
        return (r * ANGLE180 / TB_PI);
    }
    float tan(float angle) {
        /*
        * Method:
        *   Calculates the tan of a specified angle.
        * Input:
        *   angle: angle in degrees.
        */
        float r = (angle * TB_PI / ANGLE180);
        return (std::tan(r));
    }

    float atan2(float x, float y) {
        /*
        * Method:
        *   Calculates the arc-tan(x/y).
        * Input:
        *   x: floating point value.
        *   y: floating point value.
        */
        float z = (x/y);
        return ntios::math::atan(z);
    }

    char cfloat(const float num) {
        /*
        * Method:
        *   Verifies whether the value of a floating-point variable is valid.
        * Input:
        *   num: floating point value.
        * Output:
        *   0: VALID
        *   1: INVALID
        * Remark:
        *   Floating-point calculations can lead to invalid result 
        *       (#INF, -#INF errors, as per IEEE specification). 
        *       When your application is in the debug mode you will get 
        *       a FPERR exception if such an error is encountered. 
        *   In the release mode the Virtual Machine won't generate an 
        *       exception, yet your application may need to know if 
        *       a certain floating-point variable contains correct value. 
        *       This is where cfloat function comes handy.
        */
        if (std::isinf(num) || std::isnan(num) || !(std::isnormal(num))) {
            return 1;
        }

        return 0;
    }

    float sqrt(float x) {
        /*
        * Method:
        *   Calculates the square-root of a specified U8, U16, U32, or FLOAT input value.
        * Input:
        *   x: numeric input value.
        * Remark:
        *   For non-float input values, the result may be less accurate (no decimals).
        */
        return std::sqrt(x);
    }

}  // namespace math
}  // namespace ntios
