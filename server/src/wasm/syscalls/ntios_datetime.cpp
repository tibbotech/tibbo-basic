/*Copyright 2021 Tibbo Technology Inc.*/

/* INCLUDES */
#include <stdio.h>
#include <ctime>

// #include "base/ntios_base.h"
// #include "base/ntios_types.h"
#include "syscalls/ntios_datetime.h"



/* NAMESPACE */
namespace ntios {
namespace datetime {
    /* ENUMERATES */
    typedef enum {
        DT_DAY,
        DT_MONTH,
        DT_YEAR,
        DT_WEEKDAY,
        DT_HOURS,
        DT_MINUTES,
        DT_MINCOUNT
    } dt_type_enum;



    /* General constants */
    const U8 ZERO = 0;

    /* Date constants */
    const U8 JAN = 1;
    const U8 FEB = JAN + 1;
    const U8 MAR = FEB + 1;
    const U8 APR = MAR + 1;
    const U8 MAY = APR + 1;
    const U8 JUN = MAY + 1;
    const U8 JUL = JUN + 1;
    const U8 AUG = JUL + 1;
    const U8 SEP = AUG + 1;
    const U8 OCT = SEP + 1;
    const U8 NOV = OCT + 1;
    const U8 DEC = NOV + 1;

    /* max day of months */
    const U8 THIRTY_ONE = 31;
    const U8 THIRTY = 30;
    const U8 TWENTY_NINE = 29;
    const U8 TWENTY_EIGHT = 28;

    /* Threshold constants */
    const U8 YEAR_MAX = 99;
    const U8 MONTH_MAX = 12;
    const U8 DATE_MIN = 1;
    const U16 MINCOUNT_MAX = 1439;
    const U8 HOURS_MAX = 23;
    const U8 MINUTES_MAX = 59;

    const U8 HOURS_PER_DAY = 24;
    const U8 MINS_PER_HOUR = 60;
    const U8 SECS_PER_MIN = 60;

    /* base year, month, day */
    const U16 YEAR_BASE = 0;
    const U8 MONTH_BASE = 1;
    const U8 DAY_BASE = 1;

    /* Modulus constants */
    const U16 MOD_400 = 400;
    const U8 MOD_100 = 100;
    const U8 MOD_60 = 60;
    const U8 MOD_7 = 7;
    const U8 MOD_4 = 4;

    /* Error related constants */
    const U16 ERRORCODE_65535 = 65535;
    const U8 ERRORCODE_255 = 255;


    /* PRIVATE FUNCTIONS */
    static U8 DateTimeCalc( /* #lizard forgives the complexity */
                            U32 daycount, dt_type_enum dt_type) {
        /*
        * Method: 
        * - returns date-related values based on the specified 'daycount' and 'dt_type'.
        * Output: 
        * - day of the month in 1-31 range.
        * - month in 1-12 range (1: January,..., December).
        * - year in 0-255 range (0: 2000, 1:,..., 2255).
        * - weekday in 1-7 range (1: Monday,..., 7: Sunday).
        * REMARK:
        * - The base date for the day count is 1-Jan-2000 (this SATURDAY, and day #0).
        * - Do not forget the leap years! 
        * Rules of Leap Years:
        * 1. A year may be a leap year if it is evenly divisible by 4.
        * 2. Years that are divisible by 100 (century years such as 1900 or 2000) .
        *    cannot be leap years unless they are also divisible by 400.
        *    (For this reason, the years 1700, 1800, and 1900 were not leap years,
        *    but the years 1600 and 2000 were.).
        * References:
        * 1. https://www.almanac.com/content/when-next-leap-year
        * 2. https://www.infoplease.com/calendars/months-seasons/leap-year-explained
        */

        /* Variables */
        U16 yy;
        U8 mm;
        U8 dd_feb_max;
        U8 isRunning;

        /* Initial values */
        yy = YEAR_BASE;
        mm = MONTH_BASE;

        /* do not forget to include the base-day */
        daycount = daycount + DAY_BASE;

        /* Retrieve the day of month */
        isRunning = 1;
        while (isRunning == 1) {
            switch (mm) {
                case JAN:
                case MAR:
                case MAY:
                case JUL:
                case AUG:
                case OCT:
                case DEC:
                    if (daycount > THIRTY_ONE) {
                        daycount = daycount - THIRTY_ONE;
                    } else {
                        isRunning = 0;
                    }

                    break;
                case FEB:
                    /* Default value */
                    dd_feb_max = TWENTY_EIGHT;

                    /* 
                    ************************
                    * Check if 'leap year' *
                    ************************
                    * Requirement 1: divisible by 4
                    */
                    if (yy%MOD_4 == 0) {
                        /*  
                        * Requirement 2.A: NOT divisible by 100
                        * (yy%4 ==0) && (yy%100 !=0): leap year
                        */
                        if (yy%MOD_100 != 0) {
                            dd_feb_max = TWENTY_NINE;
                        } else {    /* divisible by 100 */
                            /*
                            * Requirement 2.B: divisible by 100 AND 400
                            * (yy%4 ==0) && (yy%100 == 0) && (yy%400 == 0): leap year
                            */
                            if (yy%MOD_400 == 0) { /* divisible by 400 */
                                dd_feb_max = TWENTY_NINE;
                            }
                        }
                    }

                    if (daycount > dd_feb_max) {
                        daycount = daycount - dd_feb_max;
                    } else {
                        isRunning = 0;
                    }

                    break;
                case APR:
                case JUN:
                case SEP:
                case NOV:
                    if (daycount > THIRTY) {
                        daycount = daycount - THIRTY;
                    } else {
                        isRunning = 0;
                    }

                    break;
            }

            /*
            * No flag given to stop while-loop (r != 0)
            */
            if (isRunning != 0) {
                /* Month 'mm' is currently 'DEC' &&  */
                if (mm == DEC) {
                    /* Reset 'mm' to 'JAN' */
                    mm = JAN;

                    /* Increment Year */
                    yy++;
                } else {
                    /* Increment Month */
                    mm++;
                }
            }
        }

        /* Output */
        if (dt_type == DT_DAY) {
            return daycount;
        } else if (dt_type == DT_MONTH) {
            return mm;
        } else if (dt_type == DT_YEAR) {
            return yy;
        } else {
            printf("\n\n***An error occured in:" \
                                        "<ntios_datetime.cpp>," \
                                            "function <DateTimeCalc>");
            printf("***Invalid input 'dt_type: %d", dt_type);

            return -1;
        }
    }

    pl_days_of_week WeekDayCalc(U32 daycount) {
        /* BASE date: 1-Jan-2000 (Saturday) */
        /* Saturday -> Weekday: 6 */
        const U8 WEEKDAY_BASE = 6;

        /* Add 'WEEKDAY_BASE' to 'daycount' */
        daycount = daycount + WEEKDAY_BASE;

        /* Calculate the weekday using modulus */
        U8 week_day = daycount%MOD_7;

        /* Output */
        if (week_day == 0) {
            return PL_DOW_SUNDAY;
        } else {
            return static_cast<pl_days_of_week>(week_day);
        }
    }

    bool DayCountCalc_ParamAreValid( /* #lizard forgives the complexity */
                                    const U8 &year, \
                                        const U8 &month, \
                                            const U8 &date) {
        /* Variables */
        U8 dd_feb_max;

        /* Validate year */
        if (year > YEAR_MAX) {
            return false;
        }

        /* Validate month */
        if (month > MONTH_MAX) {
            return false;
        }

        /* Validate date */
        if (date < DATE_MIN) {
            return false;
        }

        switch (month) {
            case JAN:
            case MAR:
            case MAY:
            case JUL:
            case AUG:
            case OCT:
            case DEC:
                if (date > 31) {
                    return false;
                } else {
                    return true;
                }

                break;
            case FEB:
                /*
                * Regarding explanation Leap Year (see function DateTimeCalc)
                */
                dd_feb_max = TWENTY_EIGHT;

                /* divisible by 4 */
                if (year%MOD_4 == 0) {
                    if (year%MOD_100 != 0) {
                        dd_feb_max = TWENTY_NINE;
                    } else {    /* divisible by 100 */
                        if (year%MOD_400 == 0) { /* divisible by 400 */
                            dd_feb_max = TWENTY_NINE;
                        }
                    }
                }

                if (date > dd_feb_max) {
                    return false;
                } else {
                    return true;
                }

                break;
            case APR:
            case JUN:
            case SEP:
            case NOV:
                if (date > THIRTY) {
                    return false;
                } else {
                    return true;
                }

                break;
        }

        /* No errors found */
        return true;
    }
    U32 DayCountCalc( /* #lizard forgives the complexity */
                        U8 year, U8 month, U8 date) {
        /*
        Method:
            returns the day number of a given year, month, date.
        Input parameters:
            - year: The year is supplied as offset from year 2000 (so, it is 6 for year 2006). Acceptable year range is 0-99 (2000-2099).
            - month: 1-12 for January-December
            - date: day of the month (1-31 with 0 is illegal)
        Details:
            - If any input parameter is illegal (year exceeds 99, month exceeds 12, etc.), 
              then this syscall will return 65535. 
            - This error value cannot be confused with an actual valid day number since 
              the maximum day number recognized by this syscall is 12-DEC-2099 (day number 36524).
        Example:
            w = daycount(06, 10, 15) ' result will be 2479 (the serial day number for October 15th, 2006)
        */

        /* Variables */
        U16 yy;
        U8 mm;
        U8 dd_feb_max;
        U8 isRunning;
        U32 day_count;
        bool paramAreValid;

        /* Validate input parameters */
        paramAreValid = DayCountCalc_ParamAreValid(year, month, date);
        if (paramAreValid == false) {
            return ERRORCODE_65535;
        }

        /* Initial values */
        yy = YEAR_BASE;
        mm = MONTH_BASE;
        day_count = -1;

        /* Retrieve the daycount */
        isRunning = 1;
        while (isRunning == 1) {
            switch (mm) {
                case JAN:
                case MAR:
                case MAY:
                case JUL:
                case AUG:
                case OCT:
                case DEC:
                    if (year != yy || month != mm) {    /* NO match found */
                        day_count = day_count + THIRTY_ONE;
                    } else {    /* match found */
                        day_count = day_count + date;

                        isRunning = 0;
                    }

                    break;
                case FEB:
                    /*
                    * Regarding explanation Leap Year (see function DateTimeCalc)
                    */
                    dd_feb_max = TWENTY_EIGHT;

                    /* divisible by 4 */
                    if (yy%MOD_4 == 0) {
                        if (yy%MOD_100 != 0) {
                            dd_feb_max = TWENTY_NINE;
                        } else {    /* divisible by 100 */
                            if (yy%MOD_400 == 0) { /* divisible by 400 */
                                dd_feb_max = TWENTY_NINE;
                            }
                        }
                    }

                    if (year != yy || month != mm) {    /* NO match found */
                        day_count = day_count + dd_feb_max;
                    } else {    /* match found */
                        day_count = day_count + date;

                        isRunning = 0;
                    }

                    break;
                case APR:
                case JUN:
                case SEP:
                case NOV:
                    if (year != yy || month != mm) {    /* NO match found */
                        day_count = day_count + THIRTY;
                    } else {    /* match found */
                        day_count = day_count + date;

                        isRunning = 0;
                    }

                    break;
            }

            if (isRunning != 0) {
                /* Month 'mm' is currently 'DEC' &&  */
                if (mm == DEC) {
                    /* Reset 'mm' to 'JAN' */
                    mm = JAN;

                    /* Increment Year */
                    yy++;
                } else {
                    /* Increment Month */
                    mm++;
                }
            }
        }

        /* Output */
        return day_count;
    }

    U16 TimeCalc(U16 mincount, U8 hours, U8 minutes, dt_type_enum dt_type) {
        /*
        * Method:
        *   Returns a time-related value based on the specified 'dt_type_enum'.
        * Input:
        *   mincount: number of minutes elapsed since midnight (00:00 is minute #0).
        *   hours: hour value ranging from 0 to 23.
        *   minutes: minute value ranging from 0 to 59.
        * Remarks:
        *   if dt_type is:
        *   - DT_HOURS | DT_MINUTES: hours = 0 and minutes = 0.
        *   - DT_MINCOUNT: mincount = 0.
        */

        /* Define variables */
        U16 retVal;

        /* Validate input parameter */
        if (dt_type != DT_MINCOUNT) {
            if (mincount > MINCOUNT_MAX) {
                return ERRORCODE_255;
            }
        } else {    /* dt_type = DT_MINCOUNT */
            if (hours > HOURS_MAX) {
                return ERRORCODE_65535;
            }

            if (minutes > MINUTES_MAX) {
                return ERRORCODE_65535;
            }
        }

        /* Convert mincount to hours*/
        if (dt_type == DT_HOURS) {
            retVal = mincount/MINS_PER_HOUR;
        } else if (dt_type == DT_MINUTES) {
            retVal = mincount%MOD_60;
        } else {
            retVal = (hours*MINS_PER_HOUR + minutes);
        }

        /* Output */
        return retVal;
    }


    /* PUBLIC FUNCTIONS */
    U8 date(U32 daycount) {
        /*
        * Method:
        *   returns the date for a given day number in the range 1-31.
        * Input:
        *   daycount: day number. Base date for the day count is 1-JAN-2000 (this is day #0).
        */
        return DateTimeCalc(daycount, DT_DAY);
    }

    pl_days_of_week weekday(U32 daycount) {
        /*
        * Method:   
        *   returns the day of the week for a given day number.
        * Remarks:
        *   One of pl_days_of_week constants:
        *   1- PL_DOW_MONDAY: Monday.
        *   2- PL_DOW_TUESDAY: Tuesday.
        *   3- PL_DOW_WEDNESDAY: Wednesday.
        *   4- PL_DOW_THURSDAY: Thursday.
        *   5- PL_DOW_FRIDAY: Friday.
        *   6- PL_DOW_SATURDAY: Saturday.
        *   7- PL_DOW_SUNDAY: Sunday.
        * Input:
        *   daycount: day number. Base date for the day count is 1-JAN-2000 (this is day #0).
        */

        return WeekDayCalc(daycount);
    }

    pl_months month(U32 daycount) {
        /*
        Method: 
            returns the month for a given day number.
        Output:
            One of pl_months constants:
            1- PL_MONTH_JANUARY: January.
            2- PL_MONTH_FEBRUARY: February.
            3- PL_MONTH_MARCH: March.
            4- PL_MONTH_APRIL: April.
            5- PL_MONTH_MAY: May.
            6- PL_MONTH_JUNE: June.
            7- PL_MONTH_JULY: July.
            8- PL_MONTH_AUGUST: August.
            9- PL_MONTH_SEPTEMBER: September.
            10- PL_MONTH_OCTOBER: October.
            11- PL_MONTH_NOVEMBER: November.
            12- PL_MONTH_DECEMBER: December.
        */

        return static_cast<pl_months>(DateTimeCalc(daycount, DT_MONTH));
    }

    U8 year(U32 daycount) {
        /*
        * Method:
        *   returns the year for a given day number, which is the last 3 digits of the year.
        * Input:
        *   daycount: day number. Base date for the day count is 1-JAN-2000 (this is day #0).
        * Examples:
        *   0 means 2000
        *   101 means 2101
        */

        return DateTimeCalc(daycount, DT_YEAR);
    }

    U32 daycount(U8 year, U8 month, U8 date) {
        /*
        * Method:
        *   returns the day number of a given year, month, date.
        * Input:
        *   year: The year is supplied as offset from year 2000 (so, it is 6 for year 2006). 
        *         Acceptable year range is 0-99 (2000-2099).
        *   month: 1-12 for January-December
        *   date: day of the month (1-31) (0 is illegal)
        * Remarks:
        *   If any input parameter is illegal (year exceeds 99, month exceeds 12, etc.)
        *       this syscall will return 65535. 
        *   This error value cannot be confused with an actual valid day number since 
        *       the maximum day number recognized by this syscall is 12-DEC-2099 (day number 36524).
        */

        return DayCountCalc(year, month, date);
    }

    U8 hours(U16 mincount) {
        /*
        *   Method:
        *       returns the hours value for a given minutes number (hours are in the 0-23 range).
        *   Input:
        *       mincount: number of minutes elapsed since midnight (00:00 is minute #0).
        *   Remarks:
        *       1. Maximum mincount number is 1439 (23:59).
        *       2. If a value higher than 1439 is supplied, this call will return 255.
        */

        return TimeCalc(mincount, ZERO, ZERO, DT_HOURS);
    }

    U8 minutes(U16 mincount) {
        /*
        * Method:
        *   returns the minutes value for given minutes number (range 0-59)
        * Input:
        *   mincount: number of minutes elapsed since midnight (00:00 is minute #0).
        * Remarks:
        *   If a value higher than 1439 is supplied, this call will return 255.
        *   This error value cannot be confused with valid output since normal minutes value cannot exceed 59.
        */

        return TimeCalc(mincount, ZERO, ZERO, DT_MINUTES);
    }

    U16 mincount(U8 hours, U8 minutes) {
        /*
        * Method:
        *   Returns the minutes number for a given hours and minutes.
        * Input:
        *   hours: hour value ranging from 0 to 23.
        *   minutes: minute value ranging from 0 to 59
        * Remarks:
        *   If any input parameter is illegal (hours exceeds 23, minutes exceeds 59, etc.)
        *       this syscall will return 65535. 
        *   This error value cannot be confused with an actual valid minute number since 
        *       the maximum minute number cannot exceed 1439.
        */

        return TimeCalc(ZERO, hours, minutes, DT_MINCOUNT);
    }

    string datetime_local_current() {
        /* CONSTANTS */
        const char *const DT_FORMAT = "%Y-%m-%d %H:%M:%S";

        /* VARIABLES */
        char buf[32] = {0}; /* Flawfinder: ignore */

        /* Get current timestamp */
        std::time_t dt_now = timestamp_local_current_milliseconds();

        /* Get date-time in the specified format 'DT_FORMAT' */
        std::strftime(buf, sizeof(buf), DT_FORMAT, std::localtime(&dt_now));

        /* OUTPUT */
        return buf;
    }

    std::time_t timestamp_local_current_milliseconds() {
        return std::chrono::system_clock::to_time_t( \
                        std::chrono::system_clock::now());
    }

}  /* namespace datetime */
}  /* namespace ntios */
