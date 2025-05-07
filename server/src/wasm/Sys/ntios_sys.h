/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYS_NTIOS_SYS_H_
#define SYS_NTIOS_SYS_H_

/* INCLUDES */
#include <string>
#include "base/ntios_config.h"
#include "base/ntios_property.h"
#include "base/ntios_types.h"



/* NAMESPACES */
namespace ntios {
namespace syst {



/* CLASS */
class SYS {
 public:
    /* CONSTRUCTOR */
    /*
    * Initializes (const) parameters
    * isChannelVal = 0
    * isBaudRateVal = PL_SSI_BAUD_FASTEST
    * etc.
    */
    SYS() {
       timeStampStart_ms = get_timeStamp_ms();
       timerCountMsVal = 0;
    }

    /* DESTRUCTOR: Deallocate Memory */
    ~SYS() {}



    /* PROPERTIES */

    /*
    * Sets/returns the period for the on_sys_timer event generation expressed in 10ms intervals.
    *
    * Remarks:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Value range: 1-255.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; default value: 50 (50*10=500ms).
    * Details:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Defines, in 10ms increments, the period at which the on_sys_timer event will be generated. 
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Platforms that do not support this property have the period fixed at 0.5 seconds.
    */
    Property<U8, SYS> onsystimerperiod{this, \
                &SYS::OnSysTimerPeriodSetter,
                    &SYS::OnSysTimerPeriodGetter,
                        PropertyPermissions::ReadWrite};

    /*
    * Returns the time (in half-second intervals) elapsed since the device powered up.
    *
    * Remarks:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Value range: 0-65535.
    * Details:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Once this timer reaches 65535 it rolls over to 0.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; The output value is a rounded up value.
    */
    Property<U16, SYS> timercount{this, \
                &SYS::TimerCountSetter,
                    &SYS::TimerCountGetter,
                        PropertyPermissions::Read};

    /*
    * Returns the time (in half-second intervals) elapsed since the device powered up.
    *
    * Remarks:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Value range: 0-4294967295.
    * Details:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Once the value of this timer reaches 4294967295, it rolls over to 0.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; The output value is a rounded up value.
    */
    Property<U32, SYS> timercount32{this, \
                &SYS::TimerCount32Setter,
                    &SYS::TimerCount32Getter,
                        PropertyPermissions::Read};

    /*
    * Returns the amount of time (in milliseconds) elapsed since the device powered up.
    *
    * Remarks:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Value range: 0-4294967295.
    * Details:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Once the value of this timer reaches 4294967295, it rolls over to 0.
    */
    Property<U32, SYS> timercountmse{this, \
                &SYS::TimerCountMseSetter,
                    &SYS::TimerCountMseGetter,
                        PropertyPermissions::Read};

    /*
    * Returns the amount of time (in milliseconds) elapsed since the device powered up.
    *
    * Remarks:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Value range: 0-4294967295.
    * Details:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Once the value of this timer reaches 4294967295, it rolls over to 0.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Care should be exercised, because this property is not read-only. For the read-only variant, see sys.timercountmse.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Executing sys.timercountms = 0, means resetting the counter to 0.
    */
    Property<U32, SYS> timercountms{this, \
                &SYS::TimerCountMsSetter,
                    &SYS::TimerCountMsGetter,
                        PropertyPermissions::ReadWrite};



    /* FUNCTIONS */

    /*
    * Prints the provided text.
    * 
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; str: text to be printed.
    */
    void debugprint(const string& str);

    /*
    * Waits for a specified number of milliseconds.
    * 
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; waitTime: number of milliseconds to wait.
    */
    void wait(U32 waitTime);



    /**************************************************************/
    /* library 'libtest' is making use of the following objects */
    inline void buffalloc() {}
    void halt();

    Property<string, SYS> version{this, NULL, &SYS::versionGetter,
                            PropertyPermissions::Read};
    /**************************************************************/

 private:
    /* <onsystimerperiod> PROPERTY parameters & functions */
    void OnSysTimerPeriodSetter(U8 isOnSysTimerPeriod);
    U8 OnSysTimerPeriodGetter() const;

    /* <timercount> PROPERTY parameters & functions */
    void TimerCountSetter(U16 dummy);
    U16 TimerCountGetter() const;

    /* <timercount32> PROPERTY parameters & functions */
    void TimerCount32Setter(U32 dummy);
    U32 TimerCount32Getter() const;

    /* <timercountmse> PROPERTY parameters & functions */
    void TimerCountMseSetter(U32 dummy);
    U32 TimerCountMseGetter() const;

    /* <timercountms> PROPERTY parameters & functions */
    U32 timerCountMsVal;
    void TimerCountMsSetter(U32 isTimerCountMs);
    U32 TimerCountMsGetter() const;

    /* VARIABLES */
    long double timeStampStart_ms;



    /* FUNCTIONS */

    /* Get timestamp in milliseconds */
    long double get_timeStamp_ms();



    /**************************************************************/
    /* library 'libtest' is making use of the following objects */
    string versionGetter() const;
    /**************************************************************/

}; /* class SYS */

} /* namespace syst */
} /* namespace ntios */

#endif  // SYS_NTIOS_SYS_H_
