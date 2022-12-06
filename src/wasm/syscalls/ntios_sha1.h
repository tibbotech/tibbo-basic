/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_SHA1_H_
#define SYSCALLS_NTIOS_SHA1_H_

/* INCLUDES */
#include <stdint.h>
#include <string>

#include "base/ntios_types.h"



/* ENUMERATES */
enum sha1_modes {
    SHA1_UPDATE,
    SHA1_FINISH
};

/* STRUCTURES */
struct sha1_ctx {
    U32 count[2];
    U32 state[5];
    U8 buffer[64];
};

/* UNIONS */
union block_union{
    U8 char_arr[64];
    U32 len_arr[16];
};

/* MACROS */

/* CONSTANTS */

/* VARIABLES */
extern sha1_ctx sha1_ctx_bckup;
extern const char *bckup_hash_ptr;
extern U32 bckup_str_len;



/* NAMESPACE */
namespace ntios {
namespace sha1 {
    /* FUNCTIONS */
    std::string sha1(const std::string &str, \
                        const std::string &input_hash, \
                            sha1_modes sha1_mode, \
                                U32 total_len);

}  // namespace sha1
}  // namespace ntios

#endif  // SYSCALLS_NTIOS_SHA1_H_
