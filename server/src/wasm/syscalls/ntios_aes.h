/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_AES_H_
#define SYSCALLS_NTIOS_AES_H_

/* INCLUDES */
#include <string>

#include "base/ntios_types.h"



/* NAMESPACE */
namespace ntios {
namespace aes {
    /* MACROS */
    #define AES128 1
    // #define AES192 1
    // #define AES256 1

    #if defined(AES256) && (AES256 == 1)
        #define AES_KEYLEN 32
        #define AES_keyExpSize 240
    #elif defined(AES192) && (AES192 == 1)
        #define AES_KEYLEN 24
        #define AES_keyExpSize 208
    #else
        #define AES_KEYLEN 16   /* Key length in bytes */
        #define AES_keyExpSize 176
    #endif



    /* STRUCTURES */
struct AES_ctx_struct {
    U8 RoundKey[AES_keyExpSize];
};



    /* FUNCTIONS */
    std::string aes128enc(const std::string &key, const std::string &plain);
    std::string aes128dec(const std::string &key, const std::string &strdata);

}  /* namespace aes */
}  /* namespace ntios */

#endif  // SYSCALLS_NTIOS_AES_H_
