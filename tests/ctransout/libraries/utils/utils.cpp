#include "global.th"

float math_pow(int base, int exp) {
float math_pow;
	float p = 1.0;
	int i;
	float xx = base;
	if (exp<0) {
		exp = -1*exp;
		xx = 1/xx;
	}
	for (i=1; i <= exp; i++) {
		p = p*xx;
	}
	math_pow = p;
	return math_pow;
}


float math_hex_to_float(string num) {
float math_hex_to_float;
	unsigned long tmp = lval("0x"+num);
	unsigned char sign = (tmp >> 31);
	unsigned long mantissa = (tmp && 0x7FFFFF) || 0x800000;// 11244903
	int exp = ((tmp >> 23) && 0xFF)-127-23;// -15	
	math_hex_to_float = mantissa*math_pow(2,exp);//343.1672
	if (sign == 1) {
		math_hex_to_float = -math_hex_to_float;
	}
	return math_hex_to_float;
}

//ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
byte(64) base64_chars = ;
		
  
		
  
		


byte(80) base64_inv = ;
	
	
	
	
	
	


void base64_encode(string *input_str, unsigned char input_len, string *result) {
	unsigned char out_len;
	byte(255) inbin = *input_str;
	byte(255) out;
	unsigned char i = 0;
	unsigned char j = 0;
	unsigned long v = 0;
	unsigned char index;
	if (input_len>254) {
		return;
	}
	out_len = input_len;
	if (input_len % 3 != 0) {
		out_len = out_len+3-(input_len % 3);
	}
	out_len = out_len/3;
	out_len = out_len*4;


	for (i=0; i <= input_len; i += 3) {
		v = inbin[i];
		if (i+1<input_len) {
			v = (v << 8) | inbin[i+1];
		} else {
			v = v << 8;
		}

		if (i+2<input_len) {
			v = (v << 8) | inbin[i+2];
		} else {
			v = v << 8;
		}

		out[j] = base64_chars[(v >> 18) & 0x3F];
		out[j+1] = base64_chars[(v >> 12) & 0x3F];
		if (i+1<input_len) {
			out[j+2] = base64_chars[(v >> 6) & 0x3F];
		} else {
			out[j+2] = 0x3D;//=
		}

		if (i+2<input_len) {
			out[j+3] = base64_chars[v & 0x3F];
		} else {
			out[j+3] = 0x3D;//=
		}

		j = j+4;
	}

	*result = out;
	*result = mid(*result,0,out_len);

}

void base64_decode(string *input, string *result) {

	unsigned char str_len = 0;
	unsigned char i;
	unsigned char j;
	unsigned long v;
	byte(255) out;
	byte(255) inbin;
	for (i=0; i <= 255-1; i++) {
		inbin[i] = 0;
	}
	inbin = *input;

	for (i=0; i <= 255-1; i++) {
		if (inbin[i] != 0) {
			str_len = str_len+1;
		}
		out[i] = 0;
	}

	unsigned char out_len = str_len/4*3;
	for (i=str_len-1; i <= 0; i += -) {
		if (inbin[i] == 0x3D) {
			out_len = out_len-1;
		} else {
			break;
		}
	}

	j = 0;
	for (i=0; i <= str_len-1; i += 4) {

		v = base64_inv[inbin[i]-43];
		v = (v << 6) | base64_inv[inbin[i+1]-43];

		if (inbin[i+2] == 0x3D) {
			v = v << 6;
		} else {
			v = (v << 6) | base64_inv[inbin[i+2]-43];
		}
		if (inbin[i+3] == 0x3D) {
			v = v << 6;
		} else {
			v = (v << 6) | base64_inv[inbin[i+3]-43];
		}

		out[j] = (v >> 16) & 0xFF;

		if (inbin[i+2] != 0x3D) {
			out[j+1] = (v >> 8) & 0xFF;
		}

		if (inbin[i+3] != 0x3D) {
			out[j+2] = v & 0xFF;
		}


		j = j+3;
	}

	*result = out;
	*result = mid(*result,0,out_len);

}

void date_set_datetime(string *dt_string) {

	unsigned int daycounts, mincounts;
	unsigned int curr_daycounts, curr_mincounts;
	string<4> syear, smonth, sdate, shour, smin, ssec;
	unsigned char b;

	syear = mid(*dt_string,15,2);
	smonth = mid(*dt_string,9,3);
	sdate = mid(*dt_string,6,2);
	shour = mid(*dt_string,18,2);
	smin = mid(*dt_string,21,2);
	ssec = mid(*dt_string,24,2);

	switch (smonth) {
	case "Jan":
smonth = "01";
	break;
	case "Feb":
smonth = "02";
	break;
	case "Mar":
smonth = "03";
	break;
	case "Apr":
smonth = "04";
	break;
	case "May":
smonth = "05";
	break;
	case "Jun":
smonth = "06";
	break;
	case "Jul":
smonth = "07";
	break;
	case "Aug":
smonth = "08";
	break;
	case "Sep":
smonth = "09";
	break;
	case "Oct":
smonth = "10";
	break;
	case "Nov":
smonth = "11";
	break;
	case "Dec":
smonth = "12";
	break;
	default:break;
	}
	daycounts = daycount(val(syear),val(smonth),val(sdate));
	mincounts = mincount(val(shour),val(smin));
#if PLATFORM_ID  !=  EM500W && PLATFORM_ID  !=  EM510W
	rtc.getdata(curr_daycounts,curr_mincounts,b);
	if (curr_daycounts != daycounts || curr_mincounts != mincounts) {
		b = val(ssec);
		rtc.setdata(daycounts,mincounts,b);
	}
#endif		
}

string ftofixed(float r, unsigned char decimals) {
string ftofixed;
	ftofixed = ftostr(r,FTOSTR_MODE_AUTO,255);
	unsigned char pos = instr(1,ftofixed,".",1);
	if (pos == 0) {
		return ftofixed;
	} else {
		if (instr(1,ftofixed,"-",1) != 0) {
			pos = pos-1;
		}
		ftofixed = ftostr(r,FTOSTR_MODE_AUTO,pos+decimals-1);
	}
	return ftofixed;
}
