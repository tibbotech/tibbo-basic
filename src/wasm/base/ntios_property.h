/*Copyright 2021 Tibbo Technology Inc.*/

#ifndef BASE_NTIOS_PROPERTY_H_
#define BASE_NTIOS_PROPERTY_H_

#include <cstdint>
#include <stdexcept>
#include <string>

enum class PropertyPermissions : std::uint8_t {
  Read = 1,
  Write = 2,
  ReadWrite = 3
};
template <typename T, typename C>

class Property {
  using setter_t = void (C::*)(T);
  using getter_t = T (C::*)() const;

 public:
  Property(C* parentPtr, setter_t setterPtr, getter_t getterPtr,
           PropertyPermissions propertyPermissions)
      : parent(parentPtr),
        setterFuncPtr(setterPtr),
        getterFuncPtr(getterPtr),
        propertyMode(propertyPermissions) {}

  operator T() const {
    if ((static_cast<::std::uint8_t>(propertyMode) &
         static_cast<::std::uint8_t>(PropertyPermissions::Read)) > 0) {
      return (parent->*getterFuncPtr)();
    } else {
      throw std::runtime_error("This property is write only");
    }
  }

  C& operator=(T value) {
    if ((static_cast<::std::uint8_t>(propertyMode) &
         static_cast<::std::uint8_t>(PropertyPermissions::Write)) > 0) {
      (parent->*setterFuncPtr)(value);
      return *parent;
    }
    throw std::runtime_error("This property is read only");
  }

  Property& operator=(const Property& value) {
    if ((static_cast<::std::uint8_t>(propertyMode) &
         static_cast<::std::uint8_t>(PropertyPermissions::Write)) > 0) {
      T pval = ((value.parent)->*getterFuncPtr)();
      (parent->*setterFuncPtr)(pval);

      return *this;
    }
    throw std::runtime_error("This property is read only");
  }

 private:
  C* const parent;
  setter_t const setterFuncPtr;
  getter_t const getterFuncPtr;
  PropertyPermissions propertyMode;
};


#endif  // BASE_NTIOS_PROPERTY_H_