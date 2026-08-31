# Loaded through a pipe by a new interactive login Bash. No remote dotfiles are written.
# POSIX startup gives us one initialization point; restore normal Bash before profiles run.
builtin set +o posix
builtin shopt -u inherit_errexit 2>/dev/null || :
if [[ ${CLASSDOCK_PREVIOUS_ENV_SET-} == x ]]; then
    builtin export ENV="$CLASSDOCK_PREVIOUS_ENV"
else
    builtin unset ENV
fi
builtin unset CLASSDOCK_PREVIOUS_ENV CLASSDOCK_PREVIOUS_ENV_SET
__classdock_cwd_token=$CLASSDOCK_CWD_TOKEN
builtin unset CLASSDOCK_CWD_TOKEN

# Match login Bash's startup order. A user's profile decides whether to load .bashrc.
if [[ -r /etc/profile ]]; then builtin source /etc/profile; fi
for __classdock_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [[ -f $__classdock_profile && -r $__classdock_profile ]]; then
        builtin source "$__classdock_profile"
        break
    fi
done
builtin unset __classdock_profile

# The marker is local to this shell, not exported into nested SSH/sudo/container shells.
__classdock_cwd_owner=${BASHPID:-$$}
__classdock_report_cwd() {
    builtin local previous_status=$? LC_ALL=C encoded= character hex index
    if [[ ${BASHPID:-$$} != "$__classdock_cwd_owner" || $PWD != /* ]]; then
        builtin return "$previous_status"
    fi
    # Encode bytes, including percent signs and UTF-8, before emitting a file URI.
    for ((index=0; index<${#PWD}; index++)); do
        character=${PWD:index:1}
        case $character in
            [a-zA-Z0-9/._~-]) encoded+=$character ;;
            *) builtin printf -v hex '%%%02X' "'$character"; encoded+=$hex ;;
        esac
    done
    builtin printf '\033]7;file://classdock-%s%s\007' "$__classdock_cwd_token" "$encoded"
    builtin return "$previous_status"
}

# Preserve existing hooks and their exit status. Never evaluate a received path as code.
__classdock_prompt_declaration=$(builtin declare -p PROMPT_COMMAND 2>/dev/null) || :
if [[ $__classdock_prompt_declaration != declare\ -*r*\ PROMPT_COMMAND* ]]; then
    if [[ $__classdock_prompt_declaration == declare\ -*a*\ PROMPT_COMMAND* ]]; then
        PROMPT_COMMAND+=('${__classdock_cwd_token:+__classdock_report_cwd}')
    elif [[ $__classdock_prompt_declaration != declare\ -*A*\ PROMPT_COMMAND* ]]; then
        PROMPT_COMMAND="${PROMPT_COMMAND-}"$'\n''${__classdock_cwd_token:+__classdock_report_cwd}'
    fi
fi
builtin unset __classdock_prompt_declaration
