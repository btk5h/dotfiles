function mkscratch --description "Create a scratch folder in ~/scratches from the .template folder"
    set -l root "$HOME/scratches"
    set -l name $argv[1]

    if test -z "$name"
        set name (date +%Y-%m-%d-%H%M%S)
    end

    set -l dir "$root/$name"

    if test -e "$dir"
        echo "mkscratch: $dir already exists" >&2
        return 1
    end

    mkdir -p (dirname "$dir")

    if test -d "$root/.template"
        cp -R "$root/.template" "$dir"
    else
        mkdir "$dir"
    end

    cd "$dir"
end
