#!/bin/sh

# RPM runs the old package's removal script after installing its replacement.
# A nonzero count means another version still owns the launcher and policy.
if [ "$1" != "0" ]; then
    exit 0
fi

if command -v update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

profile='/etc/apparmor.d/${executable}'
if [ -f "$profile" ]; then
    if apparmor_status --enabled >/dev/null 2>&1; then
        if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && command -v apparmor_parser >/dev/null 2>&1; then
            apparmor_parser --remove "$profile" || true
        fi
    fi
    rm -f "$profile"
fi
