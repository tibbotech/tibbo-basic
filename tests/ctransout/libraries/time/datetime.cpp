#include "global.th"

#define DT_SECS_IN_DAY 86400

#define datetime_seconds_since_epoch 946684800
en_td_timezones datetime_tz_offset;//Time Zone Off Set, You will need to change this according to your time zone
ok_ng datetime_convert_err;
ok_ng datetime_format_err;


unsigned long datetime_to_timestamp(unsigned int days, unsigned int mins, unsigned char secs) {
unsigned long datetime_to_timestamp;
	datetime_to_timestamp = datetime_seconds_since_epoch;
	datetime_to_timestamp = datetime_to_timestamp+(days*DT_SECS_IN_DAY)+(mins*60)+secs;
	return datetime_to_timestamp;
}

unsigned long datetime_current_timestamp() {
unsigned long datetime_current_timestamp;
	unsigned int datetime_days, datetime_minutes;
	unsigned char datetime_secs;
	rtc.getdata(datetime_days,datetime_minutes,datetime_secs);
	td_local_to_gmt(datetime_days,datetime_minutes,datetime_tz_offset,PL_OFF);
	datetime_current_timestamp = datetime_seconds_since_epoch;
	datetime_current_timestamp = datetime_current_timestamp+(datetime_days*DT_SECS_IN_DAY)+(datetime_minutes*60)+datetime_secs;
	return datetime_current_timestamp;
}

void datetime_from_timestamp(unsigned long timestamp, unsigned int *days, unsigned int *mins, unsigned char *secs) {
	unsigned long remainder;
	*days = 0;
	*mins = 0;
	*secs = 0;
	timestamp = timestamp-datetime_seconds_since_epoch;
	remainder = timestamp % DT_SECS_IN_DAY;
	*days = (timestamp-remainder)/DT_SECS_IN_DAY;
	timestamp = remainder;
	remainder = timestamp % 60;
	*mins = (timestamp-remainder)/60;
	*secs = remainder;
}

void datetime_time_to_str(string<14> *ts_str, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *time_second_byte) {
	
	
	
	string<4> time_year_str, time_month_str, time_date_str, time_hour_str, time_minute_str, time_second_str;

	time_year_str = str(year(*time_daycount)+2000);
	time_month_str = str(month(*time_daycount));
	time_date_str = str(date(*time_daycount));
	time_hour_str = str(hours(*time_mincount));
	time_minute_str = str(minutes(*time_mincount));
	time_second_str = str(*time_second_byte);

	if (len(time_hour_str)<2) {
		time_hour_str = "0"+time_hour_str;
	}
	if (len(time_minute_str)<2) {
		time_minute_str = "0"+time_minute_str;
	}
	if (len(time_second_str)<2) {
		time_second_str = "0"+time_second_str;
	}
	if (len(time_date_str)<2) {
		time_date_str = "0"+time_date_str;
	}
	if (len(time_month_str)<2) {
		time_month_str = "0"+time_month_str;
	}
	*ts_str = time_year_str+time_month_str+time_date_str+time_hour_str+time_minute_str+time_second_str;
}

string datetime_timestamp_to_string(unsigned long timestamp, string *format) {
string datetime_timestamp_to_string;
	unsigned int days, mins;
	unsigned char secs;
	string result = "";
	datetime_from_timestamp(timestamp,days,mins,secs);
	td_gmt_to_local(days,mins,datetime_tz_offset,PL_OFF);
	datetime_string_format(result,*format,days,mins,secs);
	datetime_timestamp_to_string = result;
	return datetime_timestamp_to_string;
}

void datetime_string_format(string<14> *result, string<14> *format, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *time_second_byte) {
	
	
	
	
	datetime_time_to_str(*result,*time_daycount,*time_mincount,*time_second_byte);

	unsigned char max = len(*format);
	unsigned char index = 1;
	string dstr = "";
	while (index<max) {
		string cur_str = mid(*format,index,1);
		switch (cur_str) {
		case "Y":

			dstr = dstr+mid(*result,1,4);
			index = index+4;
			break;
		case "M":

			dstr = dstr+mid(*result,5,2);
			index = index+2;
			break;
		case "D":

			dstr = dstr+mid(*result,7,2);
			index = index+2;
			break;
		case "h":

			dstr = dstr+mid(*result,9,2);
			index = index+2;
			break;
		case "m":

			dstr = dstr+mid(*result,11,2);
			index = index+2;
			break;
		case "s":

			dstr = dstr+mid(*result,13,2);
			index = index+2;
			break;
		default:
			dstr = dstr+cur_str;
			index = index+1;break;
		}
	}
	*result = dstr;
}

void datetime_time_to_bytestr(string<14> *ts_str, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *time_second_byte) {
	
	
	
	
	
	*ts_str = chr(*time_daycount/256);
	*ts_str = *ts_str+chr(*time_daycount & 0xFF);
	*ts_str = *ts_str+chr(*time_mincount/256);
	*ts_str = *ts_str+chr(*time_mincount & 0xFF);
	*ts_str = *ts_str+chr(*time_second_byte);
}

//------------------------------------------------------------------------------
void datetime_bytestr_to_time(string<14> *ts_str, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *time_second_byte) {
	
	
	
	
	
	*time_daycount = 256*asc(mid(*ts_str,1,1))+asc(mid(*ts_str,2,1));
	*time_mincount = 256*asc(mid(*ts_str,3,1))+asc(mid(*ts_str,4,1));
	*time_second_byte = asc(mid(*ts_str,5,1));
}

void datetime_str_to_time(string<14> *ts_str, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *time_second_byte) {
	
	
	
	unsigned char time_year, time_month, time_date, time_hour, time_min;
	string<4> time_year_str, time_month_str, time_date_str, time_hour_str, time_minute_str, time_second_str;

	time_year_str = left(*ts_str,4);
	time_month_str = mid(*ts_str,5,2);
	time_date_str = mid(*ts_str,7,2);
	time_hour_str = mid(*ts_str,9,2);
	time_minute_str = mid(*ts_str,11,2);
	time_second_str = mid(*ts_str,13,2);
	time_year = val(time_year_str)-2000;
	time_month = val(time_month_str);
	time_date = val(time_date_str);
	*time_daycount = daycount(time_year,time_month,time_date);
	if (*time_daycount == 65535) {
		datetime_convert_err = NG;
		return;
	}
	time_hour = val(time_hour_str);
	time_min = val(time_minute_str);
	*time_mincount = mincount(time_hour,time_min);
	if (*time_mincount == 65535) {
		datetime_convert_err = NG;
		return;
	}
	*time_second_byte = val(time_second_str);
	if (*time_second_byte>59) { datetime_convert_err = NG;}
}

void datetime_type_convert(string<14> *ts_str, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *time_second_byte, datetime_convert_dir convert_dir) {
	
	
	
	
	
	
//Convert time format, between string(YYYYMMDDhhmmss), and values(daycount, mincout and sec), and value string(values in a 5 bytes asciix string)
//Ex. BYTESTR_TO_TIME: user have to supply Daycount, MinCount, and second, the function returns 5 bytes time value (2bytes of daycounts, 2bytes of mincounts, and 1byte of second in ts_str.)
//TIME_TO_BYTESTR: reverse of BYTESTR_TO_TIME
//STR_TO_TIME: convert a time string in ts_str, to daycounts, mincounts and seconds
//TIME_TO_STR: reverse of STR_TIME
	datetime_convert_err = OK;
	switch (convert_dir) {
	case TIME_TO_STR:

		if (*time_daycount>36524 || *time_mincount>1439 || *time_second_byte>59) {
			datetime_convert_err = NG;
			return;
		}
		datetime_time_to_str(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		break;
	case STR_TO_TIME:

		datetime_str_to_time(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		break;
	case TIME_TO_BYTESTR:

		if (*time_daycount>36524 || *time_mincount>1439 || *time_second_byte>59) {
			datetime_convert_err = NG;
			return;
		}
		datetime_time_to_bytestr(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		break;
	case BYTESTR_TO_TIME:

		datetime_bytestr_to_time(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		break;
	case STR_TO_BYTESTR:

		datetime_str_to_time(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		if (datetime_convert_err == NG) { return;}
		datetime_time_to_bytestr(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		break;
	case BYTESTR_TO_STR:

		datetime_bytestr_to_time(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		if (*time_daycount>36524 || *time_mincount>1439 || *time_second_byte>59) {
			datetime_convert_err = NG;
			return;
		}
		datetime_time_to_str(*ts_str,*time_daycount,*time_mincount,*time_second_byte);
		break;
	}
}

unsigned long datetime_str_to_timestamp(string *datestr, string *format) {
unsigned long datetime_str_to_timestamp;
    datetime_str_to_timestamp = 0;
    string param_str = *datestr;
    unsigned int days = 0;
    unsigned int mins = 0;
    unsigned char secs = 0;
    switch (*format) {
        case "YYYYMMDD":

            param_str = param_str+"000000";
            break;
        case "YYYYMMDDhhmm":

            param_str = param_str+"00";
            break;
        case "YYYYMMDDhhmmss":

            param_str = param_str;
            break;
        case "hhmmss":

            param_str = "20000101"+param_str;
            break;
        case "hhmm":

            param_str = "20000101"+param_str+"00";
            break;
    }

    datetime_type_convert(param_str,days,mins,secs,STR_TO_TIME);
    datetime_str_to_timestamp = datetime_to_timestamp(days,mins,secs);
    return datetime_str_to_timestamp;
}

unsigned long datetime_next_cron(crontab next_cron) {
unsigned long datetime_next_cron;
	unsigned long timestamp = datetime_current_timestamp();
	unsigned int days = 0;
	unsigned int mins = 0;
	unsigned char secs = 0;
	unsigned char c_month;
	unsigned char c_date;
	unsigned int c_hour;
	unsigned int c_mins;
	unsigned char c_weekday;
	unsigned long tmp = 0;

	if (next_cron.month == "" || next_cron.day == "" || next_cron.hour == "" || next_cron.minute == "" || next_cron.day_of_week == "") {
		datetime_next_cron = 4294967295;
		return datetime_next_cron;
	}

	timestamp = timestamp+60;
	bool ended = false;
	bool skip = false;
	while (ended != true) {
		skip = false;
		datetime_from_timestamp(timestamp,days,mins,secs);
		td_gmt_to_local(days,mins,datetime_tz_offset,PL_OFF);
		c_month = month(days);
		c_date = date(days);
		c_hour = hours(mins);
		c_mins = minutes(mins);
		c_weekday = weekday(days);

		if (next_cron.month != 255 && next_cron.month != c_month) {
			unsigned long diff;
			if (val(next_cron.month)>c_month) {
				diff = daycount(year(days),val(next_cron.month),1)-daycount(year(days),c_month,date(days));
			} else {
				diff = daycount(year(days),12,31)-daycount(year(days),c_month,date(days));
				timestamp = timestamp+(86400-(60*60*c_hour)-(60*c_mins));
			}
			timestamp = timestamp+(diff*24*60*60);
			skip = true;
		}

		if (next_cron.day != 255 && next_cron.day != c_date && skip == false) {
			skip = true;
			timestamp = timestamp+(24*60*60*1);
			timestamp = timestamp-(60*60*c_hour)-(60*c_mins);
		}

		if (next_cron.day_of_week != 255 && skip == false) {
			unsigned char ci = 2;
			string<1> ci_day = mid(next_cron.day_of_week,1,1);
			byte(7) cron_trans_weekdays = ;
			bool found = false;
			while (len(ci_day)>0) {
				if (cron_trans_weekdays[val(ci_day)] == c_weekday) {
					found = true;
				}
				if (ci != 0) {
					ci = ci+1;
					ci_day = mid(next_cron.day_of_week,ci,1);
					ci = instr(ci,next_cron.day_of_week,",",1);
				} else {
					ci_day = "";
				}
			}
			if (found != true) {
				skip = true;
				timestamp = timestamp+(24*60*60*1);
				timestamp = timestamp-(60*60*c_hour)-(60*c_mins);
			}
		}

		if (next_cron.hour != 255 && next_cron.hour != c_hour && skip == false) {
			skip = true;
			timestamp = timestamp+(60*60*1);
			timestamp = timestamp-(60*c_mins);
		}

		if (next_cron.minute != 255 && next_cron.minute != c_mins && skip == false) {
			skip = true;
			timestamp = timestamp+(60*1);
		}

		if (skip == false) {
			timestamp = timestamp-secs;
			ended = true;
		}
	}

	datetime_next_cron = timestamp;
	return datetime_next_cron;
}