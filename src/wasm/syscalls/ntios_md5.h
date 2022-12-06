/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_MD5_H_
#define SYSCALLS_NTIOS_MD5_H_

/* INCLUDES */
#include <string>

#include "base/ntios_types.h"



/* CONSTANTS */



/* ENUMERATES */
typedef enum {
    MD5_UPDATE,
    MD5_FINISH
} md5_modes;

/* STRUCTURES */
/*
* MD5 context
*   count: number of bits, modulo 2^64 (lsb first)
*   state: state (ABCD)
*   buffer: input (digest) buffer
*/
struct md5_ctx {
    U32 count[2];
    U32 state[4];
    U8 buffer[64];
};

/* MACROS */

/* CONSTANTS */

/* VARIABLES */
extern md5_ctx md5_ctx_bckup;
extern const char *bckup_hash_ptr;
extern U32 bckup_str_len;



/* NAMESPACE */
namespace ntios {
namespace md5 {
    /* 
    *********************************************************************
    * MACROS
    *********************************************************************
    * BASED ON RFC-1321: https://datatracker.ietf.org/doc/html/rfc1321
    *********************************************************************
    *   Macro F:
    * step1.1: x AND y -> result A
    * step1.2: ~x AND z (~x means invert bit-values of x) -> result B
    * step2: A OR B
    */
    #define F(x, y, z) ((x & y) | (~x & z)) /* NOLINT */
    /* 
    *   Macro G:
    * step1.1: x AND z -> result C
    * step1.2: y AND ~z (~z means invert bit-values of z) -> result D
    * step2: C OR D
    */
    #define G(x, y, z) ((x & z) | (y & ~z)) /* NOLINT */
    /* 
    *   Macro H:
    * step1: x XOR y XOR z
    */
    #define H(x, y, z) (x^y^z)
    /*
    *   Macro I:
    * step1: x OR ~z (~z means invert bit-values of z) -> result E
    * step2: y XOR E
    */
    #define I(x, y, z) (y ^ (x | ~z))

    /*
    * Macro ROTATE_LEFT:
    * step1.1: x LEFTSHIFT n bits -> result F
    * step1.2: x RIGHTSHIFT (32-n) bits -> result G
    * step2: F OR G
    */
    #define ROTATE_LEFT(x, n) ((x << n) | (x >> (32-n)))



    /* 
    * FF, GG, HH, and II transformations for rounds 1, 2, 3, and 4.
    * Rotation is separate from addition to prevent recomputation.
    */
    /*
    * Macro FF:
    */    
    #define FF(a, b, c, d, x, s, ac) { \
        a += F(b, c, d) + x + ac; \
        a = ROTATE_LEFT(a, s); \
        a += b; \
    }

    /*
    * Macro GG:
    */     
    #define GG(a, b, c, d, x, s, ac) { \
          a += G(b, c, d) + x + ac; \
          a = ROTATE_LEFT(a, s); \
          a += b; \
    }

    /*
    * Macro HH:
    */       
    #define HH(a, b, c, d, x, s, ac) { \
          a += H(b, c, d) + x + ac; \
          a = ROTATE_LEFT(a, s); \
          a += b; \
    }

    /*
    * Macro II:
    */  
    #define II(a, b, c, d, x, s, ac) { \
          a += I(b, c, d) + x + ac; \
          a = ROTATE_LEFT(a, s); \
          a += b; \
    }



    /* FUNCTIONS */
    std::string md5(const std::string &str, \
                        const std::string &input_hash, \
                            md5_modes md5_mode, \
                                U32 total_len);


}  // namespace md5
}  // namespace ntios

#endif  // SYSCALLS_NTIOS_MD5_H_
