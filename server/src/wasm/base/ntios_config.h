/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef BASE_NTIOS_CONFIG_H_
#define BASE_NTIOS_CONFIG_H_

#include <mutex>  // NOLINT Google does not like mutex

#define NTIOS_PLATFORM_NAME "LTPP3G2"
#define NTIOS_VER_NUM "0.0.1"
#define NTIOS_VER_STRING '<', TIOS_PLATFORM_NAME, '-', TIOS_VER_NUM, '>', '\0'
extern std::mutex tios_critical_mutex;

/// TODO remove FROMISR variable use the
#define TIOS_IS_ISR() 0
#define TIOS_CREATE_ISRSTATUS()
#define TIOS_ENTER_CRITICAL()  // tios_critical_mutex.lock()
#define TIOS_EXIT_CRITICAL()  // tios_critical_mutex.unlock()

#define TIOS_NOSW_YES()  // tios_critical_mutex.lock()
#define TIOS_NOSW_NO()  // tios_critical_mutex.unlock()

#define TIOS_IN_RAM
#define TIOS_ALIGN_4 __attribute__((__aligned__(4)))

#define EV1_QUEUE_NAME "/EV1Q"
#define EV2_QUEUE_NAME "/EV2Q"
#define EV1_MAX_ITEMS 64
#define EV2_MAX_ITEMS 64

#define TIOS_WEAK __attribute__((weak))

/*
* (Linux) GPIO-lines 0-63 in Use by Tibbo.
* Remark:
*   1. Totally there are 100 GPIO-lines (0-99)
*   2. On the LTPP3-G2, use command 'gpioinfo' to get the GPIO-line-info.
*/
#define LINUX_NUM_IO 64
/* Tibbo IO-num 0-55 visible to users */
#define NUM_IO 56
/* Unused IO-nums: 56 - 59 */
#define NUM_IO_56TO59_UNUSED 4
/* Tibbo IO-num 62 (PL_STATUS_REDLED) & 63 (PL_STATUS_GREENLED) */
#define NUM_IO_STATUS 2
/* Tibbo IO-num 60 (PL_SIGNAL_CLKPIN) & 61 (PL_SIGNAL_DATAPIN) */
#define NUM_IO_SIGNAL 2
/* Total of Tibbo IO-nums in use */
#define NUM_IO_TOTAL (NUM_IO + \
                        NUM_IO_56TO59_UNUSED + \
                        NUM_IO_STATUS + \
                        NUM_IO_SIGNAL)
/* IO-PORT 0-3 visible to users */
#define NUM_IO_PORT 4

#define NUM_SSI_CHANNELS 4  /* used in ntios_ssi.h and ntios_ssi.cpp */

#define NUM_PAT_CHANNEL_USER_MAX 5
/* Remark: number 62 is derived from SIGNAL LED6 and LED2 */
#define NUM_PAT_CHANNEL_SIGNAL 62
#define NUM_PAT_CHANNEL_STATUS 0
#define NUM_PAT_CHANNEL_INUSE 6  /* channel: 0 - 4, 62 */
#define NUM_PAT_CHANNEL_MAX 255
#define NUM_PAT_CHANNEL_SEQNO_MAX 255
#define NUM_PAT_UPDATEQUEUE_MAX 255
/* Currently number of channels = 6 (channel: 0-4, 62) */
// #define NUM_PAT_UPDATEQUEUE_MAX ((NUM_PAT_CHANNEL_INUSE * \
                        // (NUM_PAT_CHANNEL_SEQNO_MAX + 1)) - 1)
#define NUM_PAT_SEQGRP_MAX 255
#define PAT_SPEED_20 20     /* Wait for 20 cycles */

#define NUM_BEEP_SEQNO_MAX 255
#define NUM_BEEP_UPDATEQUEUE_MAX 255
#define BEEP_DUTY_CYCLE_PERC_50 50
#define BEEP_DUTY_CYCLE_PERC_MIN 0
#define BEEP_DUTY_CYCLE_PERC_MAX 100
#define BEEP_FREQ_350K 350000
#define BEEP_FREQ_MIN 1265
#define BEEP_PWM_CHANNEL 0
#define BEEP_SPEED_20 20    /* Wait for 20 cycles */

#define MAX_UARTS 5
#define NUM_UARTS 4

#define DEFAULT_BUFF_SIZE 1024

#define MAX_SOCKETS 32



#endif  // BASE_NTIOS_CONFIG_H_
