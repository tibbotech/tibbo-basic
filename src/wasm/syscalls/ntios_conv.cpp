/*Copyright 2021 Tibbo Technology Inc.*/

/* INCLUDES */
#include <cxxabi.h> /* required for __cxa_demangle */
#include <sstream>
#include <string>
#include <iostream>
#include <iomanip>  /* required for precision */
#include <bitset>
#include <typeinfo>

#include "base/ntios_types.h"
#include "syscalls/ntios_conv.h"
#include "syscalls/ntios_strman.h"

/* MACROS */
#define TB_BIN_SIGN "&b"
#define TB_BIN_SIGN0 "&b0"
#define TB_HEX_SIGN "&h"
#define HEX_SIGN "0x"

/* CONSTANTS */
const char *const TB_EMPTYSTRING = "";
const char *const TB_DOT = ".";
const char *const TB_ZERO = "0";
const char *const TB_NINE = "9";

const char *const TB_CHR = "CHR";
const char *const TB_HEX = "HEX";
const char *const TB_LHEX = "LHEX";
const char *const TB_HEX2CHR = "HEX2CHR";

const U8 TB_8BIT = 8;
const U8 TB_16BIT = 16;
const U8 TB_24BIT = 24;
const U8 TB_32BIT = 32;

const U8 TB_1CHAR = 1;
const U8 TB_2CHAR = 2;
const U8 TB_3CHAR = 3;
const U8 TB_4CHAR = 4;

const U8 TB_OXFF = 0xff;

const U16 TB_STRLEN_LIMIT65K = 65535;

const U8 TB_8BIT_DEC = 255;
const U16 TB_16BIT_DEC = 65535;
const U32 TB_24BIT_DEC = 16777215;
const U32 TB_32BIT_DEC = 4294967295;



/* NAME SPACE */
namespace ntios {
namespace conv {
    /*
    *********************
    * PRIVATE FUNCTIONS *
    *********************
    */
    static std::string get_typeid() {
        /* Define constants */
        const std::string TYPEID_U32 = "unsigned int";
        const std::string TYPEID_U16 = "unsigned short";
        const std::string TYPEID_U8 = "unsigned char";

        /* 
        * Get the defined function's return type-id
        * Remark:
        *   This type-id is important because it would determine which
        *   of the below calculation will be used to return the unsigned numeric value.
        */
        S32 status;
        std::string func_typeid = \
            abi::__cxa_demangle(typeid(asc).name(), 0, 0, &status);

        /* function's return type-id is U8 */
        if (ntios::strman::instr(1, func_typeid, TYPEID_U8, 1) != 0) {
            return TYPEID_U8;

        /* function's return type-id is U16 */
        } else if (ntios::strman::instr(1, func_typeid, TYPEID_U16, 1) != 0) {
            return TYPEID_U16;

        /* function's return type-id is U32 */
        } else {    /* sourcestr.length() = 4 */
            return TYPEID_U32;
        }
    }

    static U32 chr2asc(const std::string &sourcestr) {
        /* 
        * Method:
        *   Depending on the demand, this function can converts up to 4 of the 
        *       leftmost characters of the specified string into its 
        *       Unsigned numeric value representation.
        * Input:
        *   sourcestr: string to be converted.
        */

        /*
        * HEX-schema 
        * | 31-24 | 23-16 | 15-8  | 7-0  |
        * | hex4  | hex3  | hex2  | hex1 |
        * | dec4  | dec3  | dec2  | dec1 |
        8-bits*/

        /* Define constants */
        const std::string TYPEID_U16 = "unsigned short";
        const std::string TYPEID_U8 = "unsigned char";

        /* Define variables */
        U32 ret;
        U8 leftshift, leftshift_max;
        U32 dec;
        S32 status;

        std::string func_typeid;


        /* 
        * Get the defined function's return type-id
        * Remark:
        *   This type-id is important because it would determine which
        *   of the below calculation will be used to return the unsigned numeric value.
        */
        func_typeid = abi::__cxa_demangle(typeid(asc).name(), 0, 0, &status);

        /* function's return type-id is U8 */
        if (ntios::strman::instr(1, func_typeid, TYPEID_U8, 1) != 0) {
            leftshift_max = 0;

        /* function's return type-id is U16 */
        } else if (ntios::strman::instr(1, func_typeid, TYPEID_U16, 1) != 0) {
            if (sourcestr.length() == TB_1CHAR) {
                leftshift_max = 0;

            } else {
                leftshift_max = TB_8BIT;
            }
        /* function's return type-id is U32 */
        } else {    /* sourcestr.length() = 4 */
            if (sourcestr.length() == TB_1CHAR) {
               leftshift_max = 0;

            } else if (sourcestr.length() == TB_2CHAR) {
                leftshift_max = TB_8BIT;

            } else if (sourcestr.length() == TB_3CHAR) {
                leftshift_max = TB_16BIT;

            } else {
                leftshift_max = TB_24BIT;
            }
        }

        /* Initialization */
        leftshift = leftshift_max;
        ret = 0;
        /* 
        * Get Asc-value  based on the previously obtained 'leftshift'
        * Remark:
        *   While 'leftshift != 0', keep on adding 'dec' to 'ret'. 
        */
        for (U8 i = 0; i < TB_4CHAR; i++) {
            /* start with the MOST LEFT 'sourcestr' item */
            dec = static_cast<int>(sourcestr[i]);
            /* LEFT-SHIFT with a specified 'leftshift' value */
            dec = dec <<  leftshift;

            /* Accumulate decimal value 'dec' */
            ret = ret + dec;

            /* 
            * Check if 'leftshift' is '0'
            * If TRUE, then break loop
            */
            if (leftshift != 0) {
                leftshift = leftshift - TB_8BIT;  /* substract 8-bits */
            } else {    /* leftshift = 0 */
                break;
            }
        }

        /* Output */
        return ret;
    }


    /* 
    * By using this template, the type (e.g., S16, U16, U32, etc.)
    *   can be a variable. 
    * In other words, if 'num' needs to be a SIGNED 16-bit integer (S16), and
    *   in another situation 'num' has to be an UNSIGHED 32-bit integer (U32), then
    *   that is possible thanks to this template.
    * Remark:
    *   Please note that this template has to be placed RIGHT ABOVE the function,
    *   which is making use of this template (as shown below).
    */
    template <typename T>
    static std::string int2str(const T num) {
        /*
        * Method:
        *   Converts Unsigned 16-bit numeric value into its decimal string representation.
        * Input:
        *   num: value to be converted.
        */
        return std::to_string(num);
    }

    template <typename T1, typename T2>
    static std::string int2bin(const T1 num, const T2 &bval) {
        /*
        * Method:
        *   Converts numeric value into its binary string representation.
        * Input:
        *   num: unsigned 16/32-bit value to be converted.
        */

        /* Define variables */
        std::stringstream ss;

        /* Define bset16 and bset32 */
        std::bitset<16> bset16(num);
        std::bitset<32> bset32(num);

        /* String stream */
        if (bval == TB_16BIT) {
            ss << bset16;
        } else {
            ss << bset32;
        }

        /* Convert to string */
        std::string bin_str = ss.str();
        /* Remove leading zeros '0' */
        bin_str = bin_str.erase(0, bin_str.find_first_not_of('0'));
        /* Output */
        if (bin_str == TB_EMPTYSTRING) {
            /* num exceeds U16-range (0-65535) */
            return (TB_BIN_SIGN0);
        } else {
            /* num is within U16-range (0-65535) */
            return (TB_BIN_SIGN + bin_str);
        }
    }

    template <typename T3, typename T4>
    static std::string dec2str(const T3 num, const T4 &conv_type) {
        /*
        * Method:
        *   Converts a numeric value into chr or hex.
        * Input:
        *   num: unsigned 16-bit value to be converted.
        */

        /* 
        * HEX-schema 
        * | 31-24 | 23-16 | 15-8  | 7-0  |
        * | hex4  | hex3  | hex2  | hex1 |
        * | str4  | str3  | str2  | str1 |
        */
        std::string ret;
        std::string str3;
        std::stringstream ss1, ss2;
        U8 rightshift, rightshift_max;
        U8 hex_val;

        if (conv_type == TB_HEX2CHR) {
            ss1 << num;

            ret = ss1.str();
        } else {
            if (conv_type == TB_HEX || conv_type == TB_LHEX) {
                ss2 << std::hex << num;

                ret = (TB_HEX_SIGN + ss2.str());
            } else {    /* conv_type = TB_CHR */
                if (num <= TB_8BIT_DEC) {
                    rightshift_max = 0;
                } else if (num <= TB_16BIT_DEC) {
                    rightshift_max = TB_8BIT;
                } else if (num <= TB_24BIT_DEC) {
                    rightshift_max = TB_16BIT;
                } else {    /* num <= TB_32BIT_DEC */
                    rightshift_max = TB_24BIT;
                }

                /* Initialization */
                rightshift = rightshift_max;
                ret = TB_EMPTYSTRING;
                /* 
                * Get the chr-value based on the previously obtained 'rightshift'
                * Remark:
                *   While 'rightshift != 0', keep on appending 'str' to 'ret'
                */
                while (true) {
                    /* RIGHT-SHIFT with the specified 'rightshift' value */
                    hex_val = num >> rightshift & TB_OXFF;

                    /* Initialize string-stream 'ss' */
                    std::stringstream ss3;

                    /* Convert Hex to Character */
                    ss3 << hex_val;
                    str3 = ss3.str();

                    /* Append string 'str' to 'ret' */
                    ret = ret + str3;

                    /* substract 8-bits */
                    if (rightshift !=0) {
                        rightshift = rightshift - TB_8BIT;
                    } else {
                        break;
                    }
                }
            }
        }

        /* Output */
        return ret;
    }

    static U32 str2val(const std::string &sourcestr, const U8 &bval) {
        /*
        * Method:
        *   Converts string representation of a value into n-bit value (word or short).
        * Input:
        *   sourcestr: string to be converted to its n-bit representation.
        */

        /* Define variables */
        U32 ret;
        U8 hex_pos, bin_pos;
        U8 sourcestr_len;
        U8 sourcestr_rightlen;
        std::string hex_rightstr, bin_rightstr;
        std::string hex_str, bin_str;

        /* First check if 'sourcestr' is a 'hex' or 'bin' value */
        sourcestr_len = sourcestr.length();
        hex_pos = ntios::strman::instr(1, sourcestr, TB_HEX_SIGN, 1);
        bin_pos = ntios::strman::instr(1, sourcestr, TB_BIN_SIGN, 1);

        if (hex_pos != 0) {
            sourcestr_rightlen = sourcestr_len - hex_pos - 1;
            hex_rightstr = ntios::strman::right(sourcestr, sourcestr_rightlen);
            hex_str = HEX_SIGN + hex_rightstr;

            if (bval == TB_8BIT) {
                ret = (U8)std::stoul(hex_str, nullptr, 16);
            } else if (bval == TB_16BIT) { /* val */
                ret = (U16)std::stoul(hex_str, nullptr, 16);
            } else {    /* lval */
                ret = (U32)std::stoul(hex_str, nullptr, 16);
            }
        } else if (bin_pos != 0) {
            sourcestr_rightlen = sourcestr_len - bin_pos - 1;
            bin_rightstr = ntios::strman::right(sourcestr, sourcestr_rightlen);
            bin_str = bin_rightstr;

            if (bval == TB_8BIT) {
                ret = (U8)std::stoul(bin_str, 0, 2);
            } else if (bval == TB_16BIT) { /* val */
                ret = (U16)std::stoul(bin_str, 0, 2);
            } else {    /* lval */
                ret = (U32)std::stoul(bin_str, 0, 2);
            }
        } else {
            if (bval == TB_8BIT) {
                ret = (U8)std::stoul(sourcestr);
            } else if (bval == TB_16BIT) { /* val */
                ret = (U16)std::stoul(sourcestr);
            } else {    /* lval */
                ret = (U32)std::stoul(sourcestr);
            }
        }

        /* Output */
        return ret;
    }



    /*******************
    * PUBLIC FUNCTIONS *
    ********************/
    U8 asc(const std::string &sourcestr) {
        /*
        * Method:
        *   Converts a string into its Unsigned 8, 16, or 32-bit numeric value representation.
        * Input:
        *   sourcestr: input string.
        * Remark:
        *   1. The 'return type-id' of this function can be changed based on your needs (e.g. U8, U16, or U32). 
        *   2. Make sure to define the variable using the SAME type-id as that of the function (see example).
        *      Failure to do so would result in undesired output values.
        * For example:
        *   If this function is defined as 'U32 asc(...)', this means that the variable
        *       should be defined as an Unsigned long variable (U32), thus:
        *       U32 asc_output = asc(sourcestr);
        *   If the function is defined as 'U8 asc(...)', then the variable should be defined as
        *       U8 asc_output = asc(sourcestr);
        */
        return chr2asc(sourcestr);
    }

    U32 strsum(const std::string &sourcestr) {
        /*
        * Method:
        *   Calculates sum of ASCII codes of all characters in a string.
        * Input:
        *   sourcestr: String to work on.
        * Remarks:
        *   1. The 'sourcestr' can be 65535 characters long.
        *       If the string-length is greater than 65535, the function will return a ZERO.
        *   2. This function is useful for checksum calculation.
        */

        /* Define variables */
        U32 ret;
        U32 sourcestr_len;
        U8 asc_item;
        std::string str_item;

        /* Check string-length */
        sourcestr_len = ntios::strman::len(sourcestr);

        if (sourcestr_len > TB_STRLEN_LIMIT65K) {
            return 0;
        }

        ret = 0; /* Initialization (IMPORTANT!!!) */
        for (U16 j = 0; j < sourcestr.length(); j++) {
            str_item = sourcestr[j];
            asc_item = static_cast<int>(str_item[0]);

            ret = ret + asc_item;
        }

        /* Output */
        return ret;
    }

    std::string bin(U16 num) {
        /*
        * Method:
        *   Converts an Unsigned 16-bit numeric value into its binary string representation.
        * Input:
        *   num: unsigned 16-bit value to be converted.
        */

        return int2bin(num, TB_16BIT);
    }

    std::string lbin(U32 num) {
        /*
        * Method:
        *   Converts an Unsigned 32-bit numeric value into its binary string representation.
        * Input:
        *   num: unsigned 32-bit value to be converted.
        */

        return int2bin(num, TB_32BIT);
    }

    std::string chr(U32 asciicode) {
        /* 
        * Method:
        *   Converts an Unsigned 8, 16, 32-bit numeric value into its character(s) representation.
        * Input:
        *   asciicode: an 8, 16, 32-bit decimal value.
        */

        return dec2str(asciicode, TB_CHR);
    }

    std::string hex(U16 num) {
        /*
        * Method:
        *   Converts an Unsigned 16-bit numeric value into its HEX-string representation.
        * Input:
        *   num: unsigned 16-bit value to be converted.
        */

        return dec2str(num, TB_HEX);
    }

    std::string lhex(U32 num) {
        /*
        * Method:
        *   Converts an Unsigned 32-bit numeric value into its HEX-string representation.
        * Input:
        *   num: unsigned 32-bit value to be converted.
        */

        return dec2str(num, TB_LHEX);
    }

    std::string hex2chr(U8 hexval) {
        /*
        * Method:
        *   Converts a HEX-value into its single character representation.
        * Input:
        *   hexval: 8-bit value to be converted.
        */

        return dec2str(hexval, TB_HEX2CHR);
    }

    std::string chr2hex(const std::string &sourcestr) {
        /*
        * Method:
        *   Converts single character into its HEX-string representation.
        * Input:
        *   sourcestr: string to be converted.
        */
        U8 ascii = asc(sourcestr);

        return hex(ascii);
    }

    std::string str2hex(const std::string &sourcestr) {
        /*
        * Method:
        *   Converts a string-value into its hex-string representation.
        * Input:
        *   str: string to be converted to hex-string.
        *       Maximum String-length is 65535. If the length is exceeded, 
        *       the function will return an Empty String.
        */

        /* Define variables */
        std::string ret;
        std::string str_item;
        std::string hex_str_item, hex_str_item_wo_hexsign;
        U32 sourcestr_len;
        U8 asc_item;

        /* Check string-length */
        sourcestr_len = ntios::strman::len(sourcestr);

        if (sourcestr_len > TB_STRLEN_LIMIT65K) {
            return TB_EMPTYSTRING;
        }

        /* Convert string to hex */
        for (U8 i = 0; i < ntios::strman::len(sourcestr); i++) {
            str_item = ntios::strman::mid(sourcestr, (i+1), 1);
            asc_item = ntios::conv::asc(str_item);
            hex_str_item = ntios::conv::hex(asc_item);

            hex_str_item_wo_hexsign = \
                ntios::strman::right(hex_str_item, \
                    ntios::strman::len(hex_str_item)-2);

            if (ntios::strman::len(hex_str_item_wo_hexsign) == 1) {
                hex_str_item_wo_hexsign = TB_ZERO + hex_str_item_wo_hexsign;
            }

            /* Accumulate hex-string item */
            ret = ret + hex_str_item_wo_hexsign;
        }

        /* Output */
        return ret;
    }

    std::string cchar2str(const char *const value) {
        /* Define string stream parameter */
        std::stringstream ss;

        /*  Write 'value' to 'ss' */
        ss << value;

        /* Convert 'ss' to string and output */
        return ss.str();
    }

    std::string ddstr(const std::string &str) {
        /*
        * Method:
        *   Converts "dot-decimal value" into "dot-decimal string".
        * Input:
        *   str: string of binary values
        * Remarks:
        *   This function is convenient for converting groups of bytes 
        *       representing binary data (such as IP or MAC addresses) 
        *       into their string representation.
        * Example:
        *   str = chr(192)+chr(168)+chr(100)+chr(40)
        *   ddstr_val = ddstr(str) = "192.168.100.40"
        */

        /* Define variables */
        std::string str_item;
        std::string asciistr;
        std::string ret;
        U8 asciicode;

        for (U8 i = 0; i < str.size(); ++i) {
            str_item = str[i];
            asciicode = asc(str_item);
            asciistr = int2str(asciicode);

            if (i == 0) {
                ret = asciistr;
            } else {
                ret = ret + TB_DOT + asciistr;
            }
        }

        /* Output */
        return ret;
    }

    bool isnumeric(const std::string &str) {
        /*
        * Method:
        *   Checks whether a string is numeric or not.
        * Input:
        *   str: string to be checked whether it's numeric or not.
        */
        return str.find_first_not_of("0123456789") == std::string::npos;
    }

    std::string ddval(const std::string &str) {
        /*
        * Method:
        *   Converts "dot-decimal string" into "dot-decimal value".
        * Input:
        *   str: dot-decimal string to be converted into a string of 
        *           binary values. This string should comprise one or more
        *           dot-separated decimal values in the 0-255 range.
        *           Values that exceed 255 will produce an overflow, 
        *           so result will be incorrect. If any other character 
        *           other than "0"-"9" or "." is encountered then all 
        *           digits after this character and up to the next "." (
        *           if any) will be ignored. Leading spaces before each 
        *           decimal value are allowed.
        */
        std::string ret;
        std::string str_item;
        std::string ip_8bit;
        U8 asciicode;

        /* 
        * Example: 
        *   segment:     1   2   3  4
        *   ipv4:       192.168.45.46
        *   Retrieve the first 3 ipv4-address segments (e.g. 192.168.45)
        */
        for (U8  i = 0; i < str.size(); i++) {
            str_item = str[i];

            /* Check if 'str_item' is numeric */
            if (isnumeric(str_item) == false) {    /* false */
                if (ip_8bit != TB_EMPTYSTRING) {
                    /* Convert 'ip_8bit' string to 'asciicode' */
                    asciicode = std::stoi(ip_8bit);
                    /* Convert 'asciicode' to 'chr' */
                    /* Add to 'ret' */
                    ret = ret + chr(asciicode);

                    /* IMPORTANT: Reset string */
                    ip_8bit = TB_EMPTYSTRING;
                } else {
                    ret = ret + chr(0);
                }

                /* if NOT a 'dot', then exit loop */
                if (str_item != TB_DOT) {
                    break;
                }
            } else {    /* true */
                /* Add 'str_item' to 'ip_8bit' */
                ip_8bit = ip_8bit + str_item;
            }

            /* 
            * Retrieve the 4th ipv4-address segment (e.g. 46)
            */
            if (i == (str.size() - 1)) {
                if (ip_8bit != TB_EMPTYSTRING) {
                    /* convert string to number */
                    asciicode = std::stoi(ip_8bit);

                    ret = ret + chr(asciicode);
                // } else {
                //     ret = ret + TB_EMPTYSTRING;
                }
            }
        }

        /* Output */
        return ret;
    }

    std::string ftostr(float num, ftostr_mode mode, U8 rnd) {
        /*
        * Method:
        *   Converts float value  into its string representation.
        * Input:
        *   num: float value to be converted.
        *   mode: desired output format:
        *       0- FTOSTR_MODE_AUTO: Choose between plain and mantissa/exponent format 
        *           automatically. The candidate with the shortest string is the preferred candidate.
        *       1- FTOSTR_MODE_ME: Use mantissa/exponent format.
        *       2- FTOSTR_MODE_PLAIN: Use plain format, not mantissa/exponent representation.
        *   rnd: Number of digits to round the result to (total number of non-zero digits in the integer and fractional part of mantissa).
        */
        std::stringstream ss;
        std::string ret;
        std::string ret_me;
        std::string ret_auto;
        std::string ret_plain, ret_plain_left;
        std::string expo_val_str;
        std::string ret_plain_left_item;

        U8 i;
        U8 numof_numeric, numof_zeros;
        U8 expo_pos, expo_len, expo_val;
        U8 dot_pos;

        /* 
        * FTOSTR_MODE_ME 
        * Remark:
        *  When using the 'std::scientific', the 'rnd' value is equal to
        *   the number of digits AFTER the 'dot'.
        *  What we would want is the rounding to be based on the number of 
        *   digits indepent from the 'dot'.
        * Examples:
        *  Let's assume:
        *      float f = 1234567891234.5678, mode = FTOSTR_MODE_ME, rnd = 5
        *  1. without 'std::scientific':
        *      string s = 1.2346e+012 (rounding starts from the beginning)
        *  2. with 'std::scientific':
        *      string s = 1.23457e+12 (rounding starts AFTER the decimal)
        */

        /* Redefine 'rnd' */
        if (rnd > 0) {
            rnd--;
        }
        ss << std::scientific;
        ss << std::setprecision(rnd) << num;
        ret_me = ss.str();

        /*
        * FTOSTR_MODE_PLAIN
        */
        const std::string PLUS = "+";
        const std::string ZERO = "0";
        expo_pos = ntios::strman::instr(1, ret_me, PLUS, 1);
        expo_len = ret_me.length() - expo_pos;
        expo_val_str = ntios::strman::right(ret_me, expo_len);
        expo_val = std::stoi(expo_val_str);

        /* Get the value on the left side of the '+' */
        ret_plain_left = ntios::strman::left(ret_me, expo_pos);

        /* Get numeric values only from 'ret_plain_left' */
        numof_numeric = 0;
        for (i = 0; i < ret_plain_left.size(); i++) {
            /* Goto next value */
            ret_plain_left_item = ret_plain_left[i];

            /* Check if 'str_item' is numeric */
            if (ntios::conv::isnumeric(ret_plain_left_item) == true) {
                /* Append 'ret_plain_left_item' to 'ret_plain' */
                ret_plain = ret_plain + ret_plain_left_item;

                /* Increment value */
                numof_numeric++;
            }
        }

        /* Add append 'zeros' (if needed) */
        if (expo_val > numof_numeric) {
            /* calculate the number of zeros to be appended */
            numof_zeros = expo_val - numof_numeric;
            /* add one more zero */
            numof_zeros++;

            /* Append zeros to 'ret_plain' */
            ret_plain = ret_plain + ntios::strman::strgen(numof_zeros, ZERO);

            // for (j = 0; j < numof_zeros; j++) {
            //     ret_plain =  ret_plain + ZERO;
            // }

            // /* Append one more 'zero' */
            // ret_plain =  ret_plain + ZERO;
        } else if (expo_val < numof_numeric) {
            dot_pos = expo_val + 1;   /* increment by 1*/

            /* 
            * Only insert a 'dot' if the position of the 'dot'
            * does NOT exceed the 'rnd' value.
            */
            if (dot_pos < rnd) {
                ret_plain = ret_plain.insert(dot_pos, TB_DOT);
            }
        }

        if (mode == FTOSTR_MODE_ME) {
            ret = ret_me;

        } else if (mode == FTOSTR_MODE_PLAIN) {
            ret = ret_plain;

        } else {
            if (ret_me.length() < ret_plain.length()) {
                ret_auto = ret_me;
            } else {
                ret_auto = ret_plain;
            }

            ret = ret_auto;
        }

        /* Output */
        return ret;
    }

    float strtof(const std::string &str) {
        /*
        * Method:
        *   Converts string representation of a float value into a float value.
        * Input:
        *   str: string to be converted to float
        * Remarks:
        *   1. You must keep in mind that floating-point calculations are inherently 
        *       imprecise. Not every value can be converted into its exact floating-point
        *       representation. 
        *   2. strtof can be invoked implicitly.
        */
        return std::stof(str);
    }

    std::string str(const U16 num) {
        /*
        * Method:
        *   Converts Unsigned 16-bit numeric value into its decimal string representation.
        * Input:
        *   num: value to be converted.
        */
        return int2str(num);
    }

    std::string stri(const S16 num) {
        /*
        * Method:
        *   Converts Signed 16-bit numeric value (short) into 
        *       its decimal string representation.
        * Input:
        *   num: value (-32768 to 32767) to be converted to string.
        * Remarks (NOT implementedfor c++):
        *   1. Can be invoked implicitly, through the string_var= dword_var expression.
        *   2. Compiler is smart enough to pre-calculate constant-only 
        *       expressions involving implicit use of stri function.
        */
        return int2str(num);
    }

    std::string lstr(const U32 num) {
        /*
        * Method:
        *   Converts Unsigned 32-bit numeric value into its decimal string representation.
        * Input:
        *   num: value to be converted.
        */
        return int2str(num);
    }

    std::string lstri(const S32 num) {
        /*
        * Method:
        *   Converts Signed 32-bit numeric value into its decimal string representation.
        * Input:
        *   num: value to be converted.
        */
        return int2str(num);
    }

    U8 val8(const std::string &sourcestr) {
        /*
        * Method:
        *   Converts string representation of a value into 8-bit value. 
        * Input:
        *   sourcestr: string to be converted.
        */
        return str2val(sourcestr, TB_8BIT);
    }

    U16 val(const std::string &sourcestr) {
        /*
        * Method:
        *   Converts string representation of a value into 16-bit value. 
        * Input:
        *   sourcestr: string to be converted.
        */
        return str2val(sourcestr, TB_16BIT);
    }

    U32 lval(const std::string &sourcestr) {
        /*
        * Method:
        *   Converts string representation of a value into 32-bit value. 
        * Input:
        *   sourcestr: string to be converted.
        */
        return str2val(sourcestr, TB_32BIT);
    }

}  // namespace conv
}  // namespace ntios
