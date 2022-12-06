/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef SYSCALLS_NTIOS_STRMAN_H_
#define SYSCALLS_NTIOS_STRMAN_H_

#include <string>

#include "base/ntios_types.h"

namespace ntios {
namespace strman {
    /*
    * Inserts 'insert_str' string into the 'dest_str' string at the insert position 'pos'.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; dest_str: the string to insert into.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; pos: insert position in the dest_str, counting from 1.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; insert_str: the string to insert.
    * Output:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Returns the new length of dest_str.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Returns the new dest_str, because this parameter is passed byref.
    */
    U16 insert(std::string &dest_str, \
                const U16 pos, \
                    const std::string &insert_str);

    /*
    * Checks whether the specified 'string' is a number or not.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; sourcestr: string from which to take the middle section.
    */
    no_yes isNumeric(const std::string &sourcestr);

    /*
    * Returns the length (=number of characters) of the specified string sourcestr.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; sourcestr: string from which to take the middle section.
    */
    U16 len(const std::string &sourcestr);

    /*
    * Returns a specified number of leftmost characters.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; sourcestr: string from which to take the middle section.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; len: number of characters to take.
    */
    std::string left(const std::string &sourcestr, U16 len);

    /*
    * Returns a specified number of characters starting from position pos.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; sourcestr: string from which to take the middle section.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; frompos: first character to take.
    *&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Note: leftmost character starts at position 1.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; len: number of characters to take.
    */
    std::string mid(const std::string &sourcestr, U16 frompos, U16 len);

    /*
    * Returns a specified number of rightmost characters.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; substr: substring that will be used (repeatedly).
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; len: length of the string to be generated.
    */
    std::string right(const std::string &sourcestr, U16 len);

    /*
    * Finds the Nth-occurrence of a specified substring 'substr' within a 
    *&nbsp;&nbsp;&nbsp; specified string 'sourcestr' starting from position 'frompos'.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; frompos: position in the sourcestr from which to start searching.
    *&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Note: leftmost character starts at position 1.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; sourcestr: source string in which the substring is to be found.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; substr: substring to search for within the source string.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; num: occurrence number of the substr, counting from 1.
    * Output:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; a positive number if the specified position is found in a string
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; zero if the specified Nth-occurrence of the substring is not found.
    */
    U16 instr(U16 frompos, \
                        const std::string &sourcestr, \
                        const std::string &substr, \
                        U16 num);

    /* 
    * Finds the number of occurrences of a specified substring 'substr' within a 
    *&nbsp;&nbsp;&nbsp; specified string 'sourcestr' starting from position 'frompos'.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; sourcestr: source string in which the substring is to be found.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; substr: substring to search for within the source string.
    * Output:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; a positive number if occurrences were found.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; zero if no occurrences were found.
    * Examples:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; x = ninstr("ABCABCDEABC12","BC") = 3
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; x = ninstr("ABCABCDEABC12","XY") = 0
    */
    U16 ninstr(const std::string &sourcestr, const std::string &substr);

    /* 
    * Generates a string consisting of random characters of the specified length 'len'.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; len:  length of the string to be generated.
    */
    std::string random(U16 len);    /* Flawfinder: ignore */

    /* 
    * Generates a string of a specified length 'len' consisting of repeating substrings 'substr'.
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; len: total length of the string to be generated.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; substr: sbustring which will be used to generate a string with length 'len'.
    */
    std::string strgen(const U16 len, const std::string &substr);

    /* 
    * Calculates logical AND on data in str1 and str2 arguments
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; len: length of the string to be generated.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; substr: substring that will be used (repeatedly).
    * Remarks:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; Notice that 'len' parameter specifies total resulting string length
    *&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; in bytes so the last digit(s) of the substring will be truncated if
    *&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; necessary to achieve exact required length.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; if 'substr' is an Empty String, then function will immediately return an empty string.
    */
    std::string strand(const std::string &str1, const std::string &str2);

    /* 
    * Calculates logical OR on data in str1 and str2 arguments
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; str1: string value.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; str2: string value.
    */
    std::string stror(const std::string &str1, const std::string &str2);

    /* 
    * Calculates logical XOR on data in str1 and str2 arguments
    *
    * Input:
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; str1: string value.
    *&nbsp;&nbsp;&nbsp;&nbsp;&bull; str2: string value.
    */
    std::string strxor(const std::string &str1, const std::string &str2);

}  // namespace strman
}  // namespace ntios

#endif  // SYSCALLS_NTIOS_STRMAN_H_
