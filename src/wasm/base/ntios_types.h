
/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef BASE_NTIOS_TYPES_H_
#define BASE_NTIOS_TYPES_H_

#include <cstdint>
#include <string>

typedef std::uint8_t U8;
typedef std::uint16_t U16;
typedef std::uint32_t U32;

typedef std::int8_t S8;
typedef std::int16_t S16;
typedef std::int32_t S32;

typedef std::uint32_t TIOS_ADDR;

typedef std::uint8_t byte;
typedef std::int16_t integer;
typedef std::uint16_t word;
typedef std::uint32_t dword;
typedef float real;
typedef bool boolean;

typedef std::uint8_t ok_ng;
typedef bool no_yes;

#define YES true
#define NO false
#define YES2 2

#define OK 0
#define NG 1

#define LED_OFF 0
#define LED_ON 1

using std::string;

#define PACKED __attribute__ ((packed))

#endif  // BASE_NTIOS_TYPES_H_
