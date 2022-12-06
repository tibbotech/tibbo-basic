/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_DATETIME_H_
#define SYSCALLS_NTIOS_DATETIME_H_

/* INCLUDES */
#include <string>

#include "base/ntios_types.h"



/* TYPEDEF */
typedef enum {
  PL_DOW_MONDAY,
  PL_DOW_TUESDAY,
  PL_DOW_WEDNESDAY,
  PL_DOW_THURSDAY,
  PL_DOW_FRIDAY,
  PL_DOW_SATURDAY,
  PL_DOW_SUNDAY
} pl_days_of_week;

typedef enum {
  PL_MONTH_JANUARY,
  PL_MONTH_FEBRUARY,
  PL_MONTH_MARCH,
  PL_MONTH_APRIL,
  PL_MONTH_MAY,
  PL_MONTH_JUNE,
  PL_MONTH_JULY,
  PL_MONTH_AUGUST,
  PL_MONTH_SEPTEMBER,
  PL_MONTH_OCTOBER,
  PL_MONTH_NOVEMBER,
  PL_MONTH_DECEMBER
} pl_months;



/* NAMESPACE */
namespace ntios {
namespace datetime {
  /* PUBLIC FUNCTIONS */
  U8 date(U32 daycount);
  pl_days_of_week weekday(U32 daycount);
  pl_months month(U32 daycount);
  U8 year(U32 daycount);
  U32 daycount(U8 year, U8 month, U8 date);

  U8 hours(U16 mincount);
  U8 minutes(U16 mincount);
  U16 mincount(U8 hours, U8 minutes);

  string datetime_local_current();
  std::time_t timestamp_local_current_milliseconds();

}  /* namespace datetime */
}  /* namespace ntios */

#endif  // SYSCALLS_NTIOS_DATETIME_H_
