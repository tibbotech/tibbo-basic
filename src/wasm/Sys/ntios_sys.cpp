/*Copyright 2021 Tibbo Technology Inc.*/

/* INCLUDES */
#include <string>
#include <cmath>


#include "base/ntios_config.h"
#include "base/ntios_property.h"

#include "sys/ntios_sys.h"

#include <emscripten.h>

/* EXTERN INSTANCES */
/* its counterpart can be found in threads/ntios_includes.h */
// ntios::syst::SYS sys;



/* CONSTANTS */
const U16 TB_16BIT_DEC = 65535;
const U32 TB_32BIT_DEC = 4294967295;

EM_JS(void, _debugprint, (const char* str), {
    ntios.sys.debugprint(UTF8ToString(str));
});

/* NAMESPACES */
namespace ntios {
namespace syst {
    /* PROPERTIES */

    U32 ev2_tmr_period = 50;

    void SYS::OnSysTimerPeriodSetter(U8 isOnSysTimerPeriod) {
        /*
        * Remarks:
        *   'ev2_tmr_period' is defined in 'ntios_period.h'
        *   'ev2_tmr_period' is used in 'ntios_period.cpp'
        */
       ev2_tmr_period = isOnSysTimerPeriod;
        // ntios_per.ev2_tmr_period = isOnSysTimerPeriod;
    }
    U8 SYS::OnSysTimerPeriodGetter() const {
        return ev2_tmr_period;
        // return ntios_per.ev2_tmr_period;
    }

    void SYS::TimerCountSetter(U16 dummy) {
        /* 
        * Since it's a read-only property, 
        * Nothing to do here.
        * */
        return;
    }
    U16 SYS::TimerCountGetter() const {
        /* Get current timestamp in milliseconds */
        long double timeStampCurr_ms = \
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();

        /* Get difference timestamp in milliseconds */
        long double timeStampDiff_ms = (timeStampCurr_ms - timeStampStart_ms);
        long double timeSTampDiff_500ms = round(timeStampDiff_ms/500);

        /* Check if the maximum value is exceeded */
        if (timeSTampDiff_500ms > TB_16BIT_DEC) {
            /* Keep on substracting from '65535' until value 'timeSTampDiff_500ms' 
            * is less or equal to '65535'
            */
            while (timeSTampDiff_500ms > TB_16BIT_DEC) {
                timeSTampDiff_500ms = (timeStampDiff_ms - TB_16BIT_DEC);
            }
        }

        /* OUTPUT */
        /* 
        * Remark:
        *   The output value is rounded up!!!
        */
        return timeSTampDiff_500ms;
    }

    void SYS::TimerCount32Setter(U32 dummy) {
        /* 
        * Since it's a read-only property, 
        * Nothing to do here.
        * */
        return;
    }
    U32 SYS::TimerCount32Getter() const {
        /* Get current timestamp in milliseconds */
        long double timeStampCurr_ms = \
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();

        /* Get difference timestamp in milliseconds */
        long double timeStampDiff_ms = (timeStampCurr_ms - timeStampStart_ms);
        long double timeSTampDiff_500ms = round(timeStampDiff_ms/500);

        /* Check if the maximum value is exceeded */
        if (timeSTampDiff_500ms > TB_32BIT_DEC) {
            while (timeSTampDiff_500ms > TB_32BIT_DEC) {
            /* Keep on substracting from '4294967295' until value 'timeSTampDiff_500ms' 
            * is less or equal to '4294967295'
            */
                timeSTampDiff_500ms = (timeStampDiff_ms - TB_32BIT_DEC);
            }
        }

        /* OUTPUT */
        /* 
        * Remark:
        *   The output value is rounded up!!!
        */
        return timeSTampDiff_500ms;
    }

    void SYS::TimerCountMseSetter(U32 dummy) {
        /* 
        * Since it's a read-only property, 
        * Nothing to do here.
        * */
        return;
    }
    U32 SYS::TimerCountMseGetter() const {
        /* Get current timestamp in milliseconds */
        long double timeStampCurr_ms = \
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();

        /* Get difference timestamp in milliseconds */
        long double timeStampDiff_ms = (timeStampCurr_ms - timeStampStart_ms);

        /* Check if the maximum value is exceeded */
        if (timeStampDiff_ms > TB_32BIT_DEC) {
            while (timeStampDiff_ms > TB_32BIT_DEC) {
            /* Keep on substracting from '4294967295' until value 'timeSTampDiff_500ms' 
            * is less or equal to '4294967295'
            */
                timeStampDiff_ms = (timeStampDiff_ms - TB_16BIT_DEC);
            }
        }

        /* OUTPUT */
        /* 
        * Remark:
        *   The output value is rounded up!!!
        */
        return timeStampDiff_ms;
    }

    void SYS::TimerCountMsSetter(U32 isTimerCountMs) {
        /* Reset timer-count to zero */
        this->timerCountMsVal = isTimerCountMs;

        /* The '' also has to be resetted to the current timestamp value */
        this->timeStampStart_ms = get_timeStamp_ms();
    }
    U32 SYS::TimerCountMsGetter() const {
        /* Get current timestamp in milliseconds */
        long double timeStampCurr_ms = \
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();

        /* Get difference timestamp in milliseconds */
        long double timeStampDiff_ms = (timeStampCurr_ms - timeStampStart_ms);

        /* Check if the maximum value is exceeded */
        if (timeStampDiff_ms > TB_32BIT_DEC) {
            while (timeStampDiff_ms > TB_32BIT_DEC) {
            /* Keep on substracting from '4294967295' until value 'timeSTampDiff_500ms' 
            * is less or equal to '4294967295'
            */
                timeStampDiff_ms = (timeStampDiff_ms - TB_16BIT_DEC);
            }
        }

        /* OUTPUT */
        /* 
        * Remark:
        *   The output value is rounded up!!!
        */
        return timeStampDiff_ms;
    }

    /* PUBLIC FUNCTIONS */
    void SYS::debugprint(const string& str) {
        /* 
        * Flush and do NOT set printf buffer
        * Remark:
        *   This will make sure that the debugprints are printed out immediately
        *   instead of waiting until the buffer is full.
        */
        // fflush(stdout);
        // setbuf(stdout, NULL);

        // printf("%s", (str.c_str()));
        // EM_JS(void, call_alert, (), {
        //     console.log('hello world!');
        //     throw 'all done';
        // });

        // cout << str << endl;
        _debugprint(str.c_str());
        // MAIN_THREAD_EM_ASM({
        //     ntios.sys.debugprint(UTF8ToString(str.c_str()));
        // });
    }

    

    void SYS::wait(U32 waitTime) {
        /*
        * Remark:
        *   1. Requires #include <thread>.
        *   2. This library is included indirectly in 'base/ntios_base.h'
        *       via '#include "threads/ntios_p1.h"' and '#include "threads/ntios_p2.h"'
        */
        // std::this_thread::sleep_for(std::chrono::milliseconds(waitTime));
    }


    /* library 'libtest' is making use of this */
    void SYS::halt() { throw std::runtime_error("Program called sys.halt"); }

    string SYS::versionGetter() const { return "JSSimulator-0.00.01"; }



    /* PRIVATE FUNCTIONS */
    long double SYS::get_timeStamp_ms() {
        /* Gets and calculates the timestamp in milliseconds */
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
    }



} /* namespace syst */
} /* namespace ntios */
