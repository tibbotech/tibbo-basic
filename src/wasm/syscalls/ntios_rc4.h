/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_RC4_H_
#define SYSCALLS_NTIOS_RC4_H_

/* INCLUDES */
#include <string>

#include "base/ntios_types.h"



/* NAMESPACE */
namespace ntios {
namespace rc4 {
    /* FUNCTIONS */
    std::string rc4(const std::string &key, \
                    size_t skip, \
                        const std::string &data);

}  // namespace rc4
}  // namespace ntios

#endif  // SYSCALLS_NTIOS_RC4_H_
