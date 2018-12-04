" syntax highlighting
syntax on

" filetype stuff
filetype plugin indent on

" indent stuff
set tabstop=2
set softtabstop=2
set shiftwidth=2
set expandtab

" performance
set ttyfast
set lazyredraw
set updatetime=100

" QoL info
set number
set relativenumber
set wildmenu
set cursorline
set scrolloff=3
set signcolumn=yes

" load external changes
set autoread

" backspace in insert
set backspace=indent,eol,start

" shell support
if &shell =~# 'fish$'
  set shell=sh
endif

" mouse support
set mouse=a

" line wrapping navigation
" nnoremap j gj
" nnoremap k gk

" disable arrow keys
inoremap <Up> <NOP>
inoremap <Down> <NOP>
inoremap <Left> <NOP>
inoremap <Right> <NOP>
noremap <Up> <NOP>
noremap <Down> <NOP>
noremap <Left> <NOP>
noremap <Right> <NOP>

" jk = esc
inoremap jk <Esc>

" enable navigation in insert mode
inoremap <C-k> <Up>
inoremap <C-j> <Down>
inoremap <C-h> <Left>
inoremap <C-l> <Right>

" split viewing
nnoremap <C-k> <C-w>k
nnoremap <C-j> <C-w>j
nnoremap <C-h> <C-w>h
nnoremap <C-l> <C-w>l

" plugins
if empty(glob('~/.vim/autoload/plug.vim'))
  silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs
    \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

call plug#begin('~/.vim/plugins')

Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'

Plug 'ctrlpvim/ctrlp.vim'

Plug 'raimondi/delimitmate'

Plug 'tpope/vim-surround'
Plug 'tpope/vim-repeat'
Plug 'tpope/vim-eunuch'

Plug 'tpope/vim-fugitive'
Plug 'airblade/vim-gitgutter'

Plug 'mattn/emmet-vim'
Plug 'valloric/matchtagalways'

Plug 'dag/vim-fish'

call plug#end()

" airline
set noshowmode
set laststatus=2
set ttimeoutlen=10
let g:airline_powerline_fonts=0
let g:airline_theme='atomic'
let g:airline#extensions#tabline#enabled=1
let g:airline#extensions#tabline#fnamemod=':t'

" ctrlp.vim
let g:ctrlp_show_hidden=1
let g:ctrlp_switch_buffer=0
let g:ctrlp_match_window='bottom,order:ttb'

" emmet
let g:user_emmet_install_global=0
autocmd FileType html,css EmmetInstall
let g:user_emmet_leader_key=','
let g:user_emmet_mode='i'

