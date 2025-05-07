/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_CONV_H_
#define SYSCALLS_NTIOS_CONV_H_

/* INCLUDES */
#include <string>

#include "base/ntios_types.h"

/* MACROS */

/* CONSTANTS */

/* ENUMERATES */
typedef enum {
    FTOSTR_MODE_AUTO,
    FTOSTR_MODE_ME,
    FTOSTR_MODE_PLAIN
} ftostr_mode;



/* NAMESPACE */
namespace ntios {
namespace conv {
    U8 asc(const std::string &str);
    U32 strsum(const std::string &sourcestr);
    std::string bin(U16 num);
    std::string lbin(U32 num);
    std::string chr(U32 asciicode);
    std::string hex(U16 num);
    std::string lhex(U32 num);
    U8 hex2asc(U8 hexval);
    std::string hex2chr(U8 hexval);
    std::string chr2hex(const std::string &sourcestr);
    std::string str2hex(const std::string &sourcestr);
    std::string cchar2str(const char *const value);
    std::string ddstr(const std::string &str);
    bool isnumeric(const std::string &str);
    std::string ddval(const std::string &str);
    std::string ftostr(float num, ftostr_mode mode, U8 rnd);
    float strtof(const std::string &str);
    std::string str(const U16 num);
    std::string stri(const S16 num);
    std::string lstr(const U32 num);
    std::string lstri(const S32 num);
    U8 val8(const std::string &sourcestr);
    U16 val(const std::string &sourcestr);
    U32 lval(const std::string &sourcestr);



}  // namespace conv
}  // namespace ntios

#endif  // SYSCALLS_NTIOS_CONV_H_
