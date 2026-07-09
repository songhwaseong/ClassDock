"use strict";

// ===== 파이썬 예제 갤러리: 클릭하면 새 코드로 열려 바로 ▶ 실행해볼 수 있다 =====
// 모두 표준 라이브러리(+matplotlib)만 사용 → 브라우저(Pyodide)·로컬 파이썬 양쪽에서 동작.
// 코드 문자열은 들여쓰기 보존을 위해 템플릿 리터럴의 각 줄을 0칸에서 시작한다.
const PY_SNIPPETS = [
  // ── 기초 / 출력 ──
  { cat:"기초·출력", title:"Hello, Python", emoji:"👋", name:"hello.py", code:
`name = "파이썬"
print("Hello,", name)
print("환영합니다! 🐍")
` },
  { cat:"기초·출력", title:"이름 인사 (입력)", emoji:"🙋", name:"인사.py", code:
`name = input("이름이 뭐예요? ")
print(f"반가워요, {name}님!")
` },
  { cat:"기초·출력", title:"사칙연산", emoji:"➗", name:"사칙연산.py", code:
`a, b = 17, 5
print("합:", a + b)
print("차:", a - b)
print("곱:", a * b)
print("몫:", a // b, "나머지:", a % b)
print("나눗셈:", a / b)
` },
  { cat:"기초·출력", title:"두 변수 교환", emoji:"🔁", name:"변수교환.py", code:
`a, b = 1, 2
print("전:", a, b)
a, b = b, a
print("후:", a, b)
` },
  { cat:"기초·출력", title:"형변환", emoji:"🔣", name:"형변환.py", code:
`s = "123"
n = int(s)
print(n + 1, type(n))
print(float(s) / 2)
print("나이: " + str(20))
` },

  // ── 반복 / 패턴 ──
  { cat:"반복·패턴", title:"구구단", emoji:"✖️", name:"구구단.py", code:
`for dan in range(2, 10):
    print(f"--- {dan}단 ---")
    for i in range(1, 10):
        print(f"{dan} x {i} = {dan*i}")
` },
  { cat:"반복·패턴", title:"별 피라미드", emoji:"⭐", name:"별피라미드.py", code:
`n = 5
for i in range(1, n + 1):
    print(" " * (n - i) + "*" * (2*i - 1))
` },
  { cat:"반복·패턴", title:"역삼각형 별", emoji:"🔻", name:"역삼각형.py", code:
`n = 5
for i in range(n, 0, -1):
    print("*" * i)
` },
  { cat:"반복·패턴", title:"다이아몬드 별", emoji:"💎", name:"다이아몬드.py", code:
`n = 4
for i in list(range(1, n + 1)) + list(range(n - 1, 0, -1)):
    print(" " * (n - i) + "*" * (2*i - 1))
` },
  { cat:"반복·패턴", title:"1~100 합계", emoji:"➕", name:"합계.py", code:
`total = sum(range(1, 101))
print("1부터 100까지 합:", total)
` },
  { cat:"반복·패턴", title:"짝수/홀수 나누기", emoji:"⚖️", name:"짝수홀수.py", code:
`evens = [n for n in range(1, 21) if n % 2 == 0]
odds  = [n for n in range(1, 21) if n % 2 == 1]
print("짝수:", evens)
print("홀수:", odds)
` },

  // ── 수학 / 숫자 ──
  { cat:"수학·숫자", title:"소수 찾기", emoji:"🔢", name:"소수.py", code:
`def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True

print([n for n in range(2, 51) if is_prime(n)])
` },
  { cat:"수학·숫자", title:"팩토리얼", emoji:"❗", name:"팩토리얼.py", code:
`import math
for n in range(1, 8):
    print(f"{n}! = {math.factorial(n)}")
` },
  { cat:"수학·숫자", title:"최대공약수·최소공배수", emoji:"🔗", name:"gcd_lcm.py", code:
`import math
a, b = 24, 36
g = math.gcd(a, b)
print("최대공약수:", g)
print("최소공배수:", a * b // g)
` },
  { cat:"수학·숫자", title:"약수 구하기", emoji:"🧮", name:"약수.py", code:
`n = 36
divisors = [i for i in range(1, n + 1) if n % i == 0]
print(f"{n}의 약수:", divisors)
` },
  { cat:"수학·숫자", title:"진법 변환", emoji:"🔟", name:"진법변환.py", code:
`n = 255
print("2진수:", bin(n))
print("8진수:", oct(n))
print("16진수:", hex(n))
` },
  { cat:"수학·숫자", title:"원주율 근사", emoji:"🥧", name:"원주율.py", code:
`# 라이프니츠 공식으로 파이 근사
pi = 0
for k in range(100000):
    pi += (-1) ** k / (2*k + 1)
print("근사값:", pi * 4)
` },

  // ── 문자열 ──
  { cat:"문자열", title:"문자열 뒤집기", emoji:"↩️", name:"뒤집기.py", code:
`s = "안녕하세요 파이썬"
print(s[::-1])
` },
  { cat:"문자열", title:"회문(팰린드롬) 검사", emoji:"🪞", name:"회문.py", code:
`def is_palindrome(s):
    s = s.replace(" ", "").lower()
    return s == s[::-1]

for w in ["level", "python", "기러기"]:
    print(w, "->", is_palindrome(w))
` },
  { cat:"문자열", title:"모음 개수 세기", emoji:"🅰️", name:"모음세기.py", code:
`s = "Hello Python World"
count = sum(1 for c in s.lower() if c in "aeiou")
print("모음 개수:", count)
` },
  { cat:"문자열", title:"대소문자 변환", emoji:"🔠", name:"대소문자.py", code:
`s = "Hello World"
print(s.upper())
print(s.lower())
print(s.swapcase())
print(s.title())
` },
  { cat:"문자열", title:"단어 빈도수", emoji:"📈", name:"단어빈도.py", code:
`from collections import Counter
text = "사과 바나나 사과 포도 바나나 사과"
print(Counter(text.split()))
` },
  { cat:"문자열", title:"아스키 코드표", emoji:"🔡", name:"아스키.py", code:
`for c in "ABCabc":
    print(c, "->", ord(c))
print("65 ->", chr(65))
` },

  // ── 리스트 / 자료구조 ──
  { cat:"리스트·자료구조", title:"리스트 정렬", emoji:"📋", name:"정렬.py", code:
`nums = [5, 2, 8, 1, 9, 3]
print("오름차순:", sorted(nums))
print("내림차순:", sorted(nums, reverse=True))
` },
  { cat:"리스트·자료구조", title:"최대·최소·평균", emoji:"📊", name:"통계.py", code:
`scores = [88, 92, 76, 100, 64]
print("최고점:", max(scores))
print("최저점:", min(scores))
print("평균:", sum(scores) / len(scores))
` },
  { cat:"리스트·자료구조", title:"중복 제거", emoji:"🧹", name:"중복제거.py", code:
`data = [1, 2, 2, 3, 3, 3, 4]
print("중복 제거:", sorted(set(data)))
` },
  { cat:"리스트·자료구조", title:"딕셔너리 사용", emoji:"📖", name:"딕셔너리.py", code:
`phone = {"홍길동": "010-1111", "김철수": "010-2222"}
phone["이영희"] = "010-3333"
for name, number in phone.items():
    print(name, ":", number)
` },
  { cat:"리스트·자료구조", title:"리스트 컴프리헨션", emoji:"⚡", name:"컴프리헨션.py", code:
`squares = [x * x for x in range(1, 11)]
print("제곱:", squares)
` },
  { cat:"리스트·자료구조", title:"행렬 전치", emoji:"🔀", name:"행렬전치.py", code:
`matrix = [[1, 2, 3], [4, 5, 6]]
for row in zip(*matrix):
    print(row)
` },

  // ── random / 게임 ──
  { cat:"random·게임", title:"로또 번호", emoji:"🎰", name:"로또.py", code:
`import random
nums = sorted(random.sample(range(1, 46), 6))
print("이번 주 행운의 번호:", nums)
` },
  { cat:"random·게임", title:"주사위 굴리기", emoji:"🎲", name:"주사위.py", code:
`import random
for _ in range(5):
    print("🎲", random.randint(1, 6))
` },
  { cat:"random·게임", title:"가위바위보", emoji:"✊", name:"가위바위보.py", code:
`import random
hands = ["가위", "바위", "보"]
me, com = random.choice(hands), random.choice(hands)
print("나:", me, "/ 컴퓨터:", com)
` },
  { cat:"random·게임", title:"숫자 맞히기 (입력)", emoji:"🎯", name:"숫자맞히기.py", code:
`import random
answer = random.randint(1, 100)
print("1~100 사이 숫자를 맞혀보세요!")
while True:
    guess = int(input("숫자: "))
    if guess < answer:
        print("UP ↑")
    elif guess > answer:
        print("DOWN ↓")
    else:
        print("정답! 🎉")
        break
` },
  { cat:"random·게임", title:"동전 던지기 통계", emoji:"🪙", name:"동전.py", code:
`import random
flips = [random.choice(["앞", "뒤"]) for _ in range(1000)]
print("앞:", flips.count("앞"), "/ 뒤:", flips.count("뒤"))
` },
  { cat:"random·게임", title:"랜덤 비밀번호", emoji:"🔐", name:"비밀번호.py", code:
`import random, string
chars = string.ascii_letters + string.digits
pw = "".join(random.choice(chars) for _ in range(12))
print("생성된 비밀번호:", pw)
` },

  // ── 날짜 / 시간 ──
  { cat:"날짜·시간", title:"오늘 날짜·시간", emoji:"🕒", name:"오늘.py", code:
`import datetime
now = datetime.datetime.now()
print("지금:", now.strftime("%Y-%m-%d %H:%M:%S"))
` },
  { cat:"날짜·시간", title:"이번 달 달력", emoji:"📅", name:"달력.py", code:
`import calendar, datetime
today = datetime.date.today()
print(calendar.month(today.year, today.month))
` },
  { cat:"날짜·시간", title:"요일 구하기", emoji:"📆", name:"요일.py", code:
`import datetime
days = ["월", "화", "수", "목", "금", "토", "일"]
today = datetime.date.today()
print("오늘은", days[today.weekday()], "요일")
` },
  { cat:"날짜·시간", title:"D-day 계산", emoji:"⏳", name:"dday.py", code:
`import datetime
target = datetime.date(2026, 12, 25)
left = (target - datetime.date.today()).days
print(f"크리스마스까지 D-{left}")
` },
  { cat:"날짜·시간", title:"만 나이 계산", emoji:"🎂", name:"만나이.py", code:
`import datetime
birth = datetime.date(2000, 5, 10)
today = datetime.date.today()
age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
print("만 나이:", age)
` },

  // ── 알고리즘 ──
  { cat:"알고리즘", title:"피보나치 수열", emoji:"🌀", name:"피보나치.py", code:
`a, b = 0, 1
for _ in range(15):
    print(a, end=" ")
    a, b = b, a + b
print()
` },
  { cat:"알고리즘", title:"버블 정렬", emoji:"🫧", name:"버블정렬.py", code:
`nums = [5, 2, 9, 1, 7]
for i in range(len(nums)):
    for j in range(len(nums) - 1 - i):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]
print(nums)
` },
  { cat:"알고리즘", title:"이진 탐색", emoji:"🔍", name:"이진탐색.py", code:
`data = [1, 3, 5, 7, 9, 11, 13]
target = 9
lo, hi = 0, len(data) - 1
while lo <= hi:
    mid = (lo + hi) // 2
    if data[mid] == target:
        print("찾음! 위치:", mid)
        break
    elif data[mid] < target:
        lo = mid + 1
    else:
        hi = mid - 1
` },
  { cat:"알고리즘", title:"하노이 탑", emoji:"🗼", name:"하노이.py", code:
`def hanoi(n, src, via, dst):
    if n == 1:
        print(src, "->", dst)
        return
    hanoi(n - 1, src, dst, via)
    print(src, "->", dst)
    hanoi(n - 1, via, src, dst)

hanoi(3, "A", "B", "C")
` },
  { cat:"알고리즘", title:"FizzBuzz", emoji:"🔔", name:"fizzbuzz.py", code:
`for n in range(1, 31):
    if n % 15 == 0:
        print("FizzBuzz")
    elif n % 3 == 0:
        print("Fizz")
    elif n % 5 == 0:
        print("Buzz")
    else:
        print(n)
` },

  // ── 그래프 (matplotlib) ── 한글 라벨은 폰트 문제로 영문 사용
  { cat:"그래프", title:"막대 그래프", emoji:"📊", name:"막대그래프.py", code:
`import matplotlib.pyplot as plt
labels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
values = [3, 7, 2, 5, 8]
plt.bar(labels, values)
plt.title("Study hours by day")
plt.show()
` },
  { cat:"그래프", title:"꺾은선 그래프", emoji:"📈", name:"꺾은선.py", code:
`import matplotlib.pyplot as plt
x = list(range(1, 11))
y = [v * v for v in x]
plt.plot(x, y, marker="o")
plt.title("y = x^2")
plt.show()
` },
  { cat:"그래프", title:"원 그래프", emoji:"🥧", name:"원그래프.py", code:
`import matplotlib.pyplot as plt
sizes = [40, 25, 20, 15]
labels = ["A", "B", "C", "D"]
plt.pie(sizes, labels=labels, autopct="%1.1f%%")
plt.title("Share")
plt.show()
` },
  { cat:"그래프", title:"사인 곡선", emoji:"〰️", name:"사인곡선.py", code:
`import matplotlib.pyplot as plt
import math
x = [i / 10 for i in range(0, 63)]
y = [math.sin(v) for v in x]
plt.plot(x, y)
plt.title("sin(x)")
plt.show()
` },
  { cat:"그래프", title:"3D 곡면", emoji:"🏔️", name:"3d_곡면.py", code:
`import numpy as np
import matplotlib.pyplot as plt
fig = plt.figure()
ax = fig.add_subplot(111, projection="3d")
x = np.linspace(-5, 5, 60)
y = np.linspace(-5, 5, 60)
X, Y = np.meshgrid(x, y)
Z = np.sin(np.sqrt(X**2 + Y**2))
ax.plot_surface(X, Y, Z, cmap="viridis")
ax.set_title("3D surface")
plt.show()
` },
  { cat:"그래프", title:"3D 산점도", emoji:"🎲", name:"3d_산점도.py", code:
`import numpy as np
import matplotlib.pyplot as plt
fig = plt.figure()
ax = fig.add_subplot(111, projection="3d")
n = 200
xs, ys, zs = np.random.rand(n), np.random.rand(n), np.random.rand(n)
ax.scatter(xs, ys, zs, c=zs, cmap="plasma")
ax.set_title("3D scatter")
plt.show()
` },
  { cat:"그래프", title:"3D 나선", emoji:"🌀", name:"3d_나선.py", code:
`import numpy as np
import matplotlib.pyplot as plt
fig = plt.figure()
ax = fig.add_subplot(111, projection="3d")
t = np.linspace(0, 20, 500)
ax.plot(np.cos(t), np.sin(t), t)
ax.set_title("3D helix")
plt.show()
` },

  // ── 재미 ──
  { cat:"재미", title:"ASCII 텍스트 박스", emoji:"🖼️", name:"텍스트박스.py", code:
`msg = " PYTHON "
line = "+" + "-" * len(msg) + "+"
print(line)
print("|" + msg + "|")
print(line)
` },

  // ── 함수·재귀 ──
  { cat:"함수·재귀", title:"함수 기본", emoji:"🧩", name:"함수기본.py", code:
`def add(a, b):
    return a + b

def greet(name="친구"):
    return f"안녕, {name}!"

print(add(3, 4))
print(greet())
print(greet("민수"))
` },
  { cat:"함수·재귀", title:"가변 인자", emoji:"🎁", name:"가변인자.py", code:
`def total(*nums):
    return sum(nums)

def info(**kw):
    for k, v in kw.items():
        print(f"{k} = {v}")

print("합:", total(1, 2, 3, 4))
info(name="민수", age=14)
` },
  { cat:"함수·재귀", title:"재귀 팩토리얼", emoji:"❗", name:"팩토리얼.py", code:
`def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

for i in range(1, 8):
    print(i, "! =", factorial(i))
` },
  { cat:"함수·재귀", title:"재귀 피보나치", emoji:"🐚", name:"피보나치.py", code:
`def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(15)])
` },
  { cat:"함수·재귀", title:"하노이탑", emoji:"🗼", name:"하노이탑.py", code:
`def hanoi(n, src, dst, via):
    if n == 1:
        print(f"원반 1: {src} -> {dst}")
        return
    hanoi(n - 1, src, via, dst)
    print(f"원반 {n}: {src} -> {dst}")
    hanoi(n - 1, via, dst, src)

hanoi(3, "A", "C", "B")
` },
  { cat:"함수·재귀", title:"lambda·map·filter", emoji:"🎭", name:"람다.py", code:
`nums = [1, 2, 3, 4, 5, 6]
squares = list(map(lambda x: x * x, nums))
evens = list(filter(lambda x: x % 2 == 0, nums))
print("제곱:", squares)
print("짝수:", evens)
` },

  // ── 딕셔너리·집합 ──
  { cat:"딕셔너리·집합", title:"딕셔너리 기본", emoji:"📖", name:"딕셔너리.py", code:
`scores = {"국어": 90, "수학": 85, "영어": 95}
scores["과학"] = 88
for subject, score in scores.items():
    print(f"{subject}: {score}")
print("평균:", sum(scores.values()) / len(scores))
` },
  { cat:"딕셔너리·집합", title:"단어 빈도수", emoji:"🔠", name:"단어빈도.py", code:
`from collections import Counter
text = "apple banana apple cherry banana apple"
count = Counter(text.split())
for word, n in count.most_common():
    print(f"{word}: {n}")
` },
  { cat:"딕셔너리·집합", title:"집합 연산", emoji:"🔵", name:"집합연산.py", code:
`a = {1, 2, 3, 4, 5}
b = {4, 5, 6, 7}
print("합집합:", a | b)
print("교집합:", a & b)
print("차집합:", a - b)
print("대칭차:", a ^ b)
` },
  { cat:"딕셔너리·집합", title:"값으로 정렬", emoji:"🏅", name:"값정렬.py", code:
`fruit = {"사과": 5, "바나나": 2, "체리": 8, "포도": 4}
ranked = sorted(fruit.items(), key=lambda kv: kv[1], reverse=True)
for name, n in ranked:
    print(f"{name}: {n}개")
` },
  { cat:"딕셔너리·집합", title:"중첩 딕셔너리", emoji:"🗂️", name:"중첩딕셔너리.py", code:
`students = {
    "민수": {"수학": 90, "영어": 80},
    "지은": {"수학": 85, "영어": 95},
}
for name, subjects in students.items():
    avg = sum(subjects.values()) / len(subjects)
    print(f"{name} 평균: {avg:.1f}")
` },
  { cat:"딕셔너리·집합", title:"글자 수 세기", emoji:"🔡", name:"글자수.py", code:
`word = "banana"
freq = {}
for ch in word:
    freq[ch] = freq.get(ch, 0) + 1
print(freq)
` },

  // ── 예외·입력검증 ──
  { cat:"예외·입력검증", title:"try / except", emoji:"🛡️", name:"예외처리.py", code:
`values = ["10", "abc", "3.5", "7"]
for v in values:
    try:
        print(v, "->", int(v))
    except ValueError:
        print(v, "-> 정수가 아니에요")
` },
  { cat:"예외·입력검증", title:"0으로 나누기", emoji:"🚫", name:"0나누기.py", code:
`pairs = [(10, 2), (5, 0), (9, 3)]
for a, b in pairs:
    try:
        print(f"{a} / {b} = {a / b}")
    except ZeroDivisionError:
        print(f"{a} / {b} -> 0으로 나눌 수 없어요")
` },
  { cat:"예외·입력검증", title:"숫자 검증 함수", emoji:"✅", name:"숫자검증.py", code:
`def to_int(s):
    try:
        return int(s)
    except ValueError:
        return None

for s in ["42", "-3", "삼", "100"]:
    n = to_int(s)
    print(s, "->", "유효" if n is not None else "무효", n)
` },
  { cat:"예외·입력검증", title:"여러 예외", emoji:"🚦", name:"여러예외.py", code:
`data = ["5", "0", "x"]
for s in data:
    try:
        print(s, "->", 100 / int(s))
    except ValueError:
        print(s, ": 숫자가 아니에요")
    except ZeroDivisionError:
        print(s, ": 0으로 못 나눠요")
` },
  { cat:"예외·입력검증", title:"finally 절", emoji:"🏁", name:"finally.py", code:
`nums = [1, 2, 3]
for i in [0, 5, 2]:
    try:
        print("값:", nums[i])
    except IndexError:
        print(i, "번째는 없어요")
    finally:
        print("- 확인 끝")
` },

  // ── 클래스·객체 ──
  { cat:"클래스·객체", title:"클래스 기본", emoji:"🐶", name:"클래스기본.py", code:
`class Dog:
    def __init__(self, name):
        self.name = name
    def bark(self):
        return f"{self.name}: 멍멍!"

d = Dog("바둑이")
print(d.bark())
` },
  { cat:"클래스·객체", title:"은행 계좌", emoji:"🏦", name:"계좌.py", code:
`class Account:
    def __init__(self, balance=0):
        self.balance = balance
    def deposit(self, amount):
        self.balance += amount
    def __str__(self):
        return f"잔액: {self.balance}원"

a = Account()
a.deposit(5000)
a.deposit(3000)
print(a)
` },
  { cat:"클래스·객체", title:"상속", emoji:"🐾", name:"상속.py", code:
`class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return "..."

class Cat(Animal):
    def speak(self):
        return "야옹"

class Cow(Animal):
    def speak(self):
        return "음메"

for a in [Cat("나비"), Cow("얼룩이")]:
    print(a.name, ":", a.speak())
` },
  { cat:"클래스·객체", title:"좌표 거리", emoji:"📐", name:"좌표.py", code:
`class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
    def __str__(self):
        return f"({self.x}, {self.y})"
    def dist(self, other):
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

p, q = Point(0, 0), Point(3, 4)
print(p, "~", q, "거리:", p.dist(q))
` },
  { cat:"클래스·객체", title:"dataclass", emoji:"📦", name:"dataclass.py", code:
`from dataclasses import dataclass

@dataclass
class Book:
    title: str
    price: int

books = [Book("파이썬", 15000), Book("수학", 12000)]
for b in books:
    print(b)
print("총액:", sum(b.price for b in books))
` },

  // ── 정렬·탐색 ──
  { cat:"정렬·탐색", title:"버블 정렬", emoji:"🫧", name:"버블정렬.py", code:
`nums = [5, 2, 9, 1, 7, 3]
for i in range(len(nums)):
    for j in range(len(nums) - 1 - i):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]
print(nums)
` },
  { cat:"정렬·탐색", title:"선택 정렬", emoji:"👉", name:"선택정렬.py", code:
`nums = [64, 25, 12, 22, 11]
for i in range(len(nums)):
    m = i
    for j in range(i + 1, len(nums)):
        if nums[j] < nums[m]:
            m = j
    nums[i], nums[m] = nums[m], nums[i]
print(nums)
` },
  { cat:"정렬·탐색", title:"이진 탐색", emoji:"🔎", name:"이진탐색.py", code:
`data = [1, 3, 5, 7, 9, 11, 13]
target = 9
lo, hi = 0, len(data) - 1
while lo <= hi:
    mid = (lo + hi) // 2
    if data[mid] == target:
        print("찾음! 위치:", mid)
        break
    elif data[mid] < target:
        lo = mid + 1
    else:
        hi = mid - 1
` },
  { cat:"정렬·탐색", title:"다중 기준 정렬", emoji:"🗃️", name:"다중정렬.py", code:
`people = [("민수", 14), ("지은", 13), ("현우", 14)]
by_age = sorted(people, key=lambda p: (p[1], p[0]))
for name, age in by_age:
    print(age, name)
` },
  { cat:"정렬·탐색", title:"최대·최소 찾기", emoji:"📏", name:"최대최소.py", code:
`nums = [3, 8, 1, 9, 4, 7]
biggest = smallest = nums[0]
for n in nums:
    if n > biggest:
        biggest = n
    if n < smallest:
        smallest = n
print("최대:", biggest, "최소:", smallest)
` },

  // ── 시뮬레이션·확률 ──
  { cat:"시뮬레이션·확률", title:"동전 던지기", emoji:"🪙", name:"동전.py", code:
`import random
heads = 0
trials = 1000
for _ in range(trials):
    if random.random() < 0.5:
        heads += 1
print(f"앞면 {heads}회 / {trials}회 ({heads / trials * 100:.1f}%)")
` },
  { cat:"시뮬레이션·확률", title:"주사위 합 분포", emoji:"🎲", name:"주사위분포.py", code:
`import random
counts = {}
for _ in range(1000):
    s = random.randint(1, 6) + random.randint(1, 6)
    counts[s] = counts.get(s, 0) + 1
for total in range(2, 13):
    print(f"{total:2d} | " + "#" * (counts.get(total, 0) // 10))
` },
  { cat:"시뮬레이션·확률", title:"몬테카를로 π", emoji:"🥧", name:"몬테카를로.py", code:
`import random
inside = 0
n = 10000
for _ in range(n):
    x, y = random.random(), random.random()
    if x * x + y * y <= 1:
        inside += 1
print("π 근사값:", 4 * inside / n)
` },
  { cat:"시뮬레이션·확률", title:"랜덤 워크", emoji:"🚶", name:"랜덤워크.py", code:
`import random
import matplotlib.pyplot as plt
x, y = [0], [0]
for _ in range(500):
    x.append(x[-1] + random.choice([-1, 1]))
    y.append(y[-1] + random.choice([-1, 1]))
plt.plot(x, y, linewidth=0.8)
plt.title("Random walk")
plt.show()
` },
  { cat:"시뮬레이션·확률", title:"생일 역설", emoji:"🎂", name:"생일역설.py", code:
`import random
def has_match(people):
    days = [random.randint(1, 365) for _ in range(people)]
    return len(days) != len(set(days))

for people in [10, 23, 40]:
    hits = sum(has_match(people) for _ in range(1000))
    print(f"{people}명: 생일 겹칠 확률 약 {hits / 10:.0f}%")
` },
  { cat:"시뮬레이션·확률", title:"가위바위보 대전", emoji:"✊", name:"가위바위보.py", code:
`import random
hands = ["가위", "바위", "보"]
beats = {"가위": "보", "바위": "가위", "보": "바위"}
result = {"나": 0, "컴퓨터": 0, "비김": 0}
for _ in range(10):
    me, com = random.choice(hands), random.choice(hands)
    if me == com:
        result["비김"] += 1
    elif beats[me] == com:
        result["나"] += 1
    else:
        result["컴퓨터"] += 1
print(result)
` },

  // ── 그래프 추가 (matplotlib, 영문 라벨) ──
  { cat:"그래프", title:"산점도", emoji:"✨", name:"산점도.py", code:
`import matplotlib.pyplot as plt
import random
x = [random.gauss(0, 1) for _ in range(150)]
y = [random.gauss(0, 1) for _ in range(150)]
plt.scatter(x, y, alpha=0.6)
plt.title("Scatter")
plt.show()
` },
  { cat:"그래프", title:"히스토그램", emoji:"📶", name:"히스토그램.py", code:
`import matplotlib.pyplot as plt
import random
data = [random.gauss(50, 10) for _ in range(1000)]
plt.hist(data, bins=20, color="teal")
plt.title("Histogram")
plt.show()
` },
  { cat:"그래프", title:"sin·cos 비교", emoji:"➰", name:"sin_cos.py", code:
`import matplotlib.pyplot as plt
import math
x = [i / 10 for i in range(63)]
plt.plot(x, [math.sin(v) for v in x], label="sin")
plt.plot(x, [math.cos(v) for v in x], label="cos")
plt.legend()
plt.title("sin and cos")
plt.show()
` },
  { cat:"그래프", title:"수평 막대", emoji:"📊", name:"수평막대.py", code:
`import matplotlib.pyplot as plt
langs = ["Python", "Java", "C", "Go", "Rust"]
votes = [42, 30, 18, 12, 9]
plt.barh(langs, votes, color="orange")
plt.title("Votes")
plt.show()
` },
  { cat:"그래프", title:"영역 채우기", emoji:"🌊", name:"영역채우기.py", code:
`import matplotlib.pyplot as plt
x = list(range(10))
y = [v * v for v in x]
plt.fill_between(x, y, color="skyblue", alpha=0.5)
plt.plot(x, y, color="navy")
plt.title("Area under y = x^2")
plt.show()
` },
  { cat:"그래프", title:"여러 그래프", emoji:"🖼️", name:"서브플롯.py", code:
`import matplotlib.pyplot as plt
import math
x = [i / 10 for i in range(63)]
fig, (ax1, ax2) = plt.subplots(1, 2)
ax1.plot(x, [math.sin(v) for v in x])
ax1.set_title("sin")
ax2.plot(x, [math.cos(v) for v in x], color="red")
ax2.set_title("cos")
plt.show()
` },

  // ── 문자열 (추가) ──
  { cat:"문자열", title:"회문 검사", emoji:"🔄", name:"회문.py", code:
`words = ["기러기", "토마토", "파이썬", "level"]
for w in words:
    print(w, "->", "회문!" if w == w[::-1] else "아니에요")
` },
  { cat:"문자열", title:"모음 세기", emoji:"🅰️", name:"모음세기.py", code:
`text = "Hello Python World"
vowels = "aeiouAEIOU"
count = sum(1 for ch in text if ch in vowels)
print("모음 개수:", count)
` },
  { cat:"문자열", title:"시저 암호", emoji:"🔐", name:"시저암호.py", code:
`def caesar(text, shift):
    out = ""
    for ch in text:
        if ch.isalpha():
            base = ord("A") if ch.isupper() else ord("a")
            out += chr((ord(ch) - base + shift) % 26 + base)
        else:
            out += ch
    return out

enc = caesar("Hello", 3)
print("암호화:", enc)
print("복호화:", caesar(enc, -3))
` },
  { cat:"문자열", title:"단어 뒤집기", emoji:"↔️", name:"단어뒤집기.py", code:
`sentence = "파이썬 은 정말 재미있다"
words = sentence.split()
print(" ".join(reversed(words)))
print(" ".join(w[::-1] for w in words))
` },
  { cat:"문자열", title:"문자 종류 통계", emoji:"🔣", name:"문자통계.py", code:
`text = "Hello, Python 123!"
upper = sum(c.isupper() for c in text)
lower = sum(c.islower() for c in text)
digit = sum(c.isdigit() for c in text)
print(f"대문자 {upper}, 소문자 {lower}, 숫자 {digit}")
` },

  // ── 수학·숫자 (추가) ──
  { cat:"수학·숫자", title:"소수 찾기(에라토스테네스)", emoji:"🧮", name:"소수.py", code:
`n = 50
sieve = [True] * (n + 1)
sieve[0] = sieve[1] = False
for i in range(2, int(n ** 0.5) + 1):
    if sieve[i]:
        for j in range(i * i, n + 1, i):
            sieve[j] = False
print([i for i in range(n + 1) if sieve[i]])
` },
  { cat:"수학·숫자", title:"약수 구하기", emoji:"🔻", name:"약수.py", code:
`n = 36
divisors = [i for i in range(1, n + 1) if n % i == 0]
print(f"{n}의 약수:", divisors)
print("개수:", len(divisors))
` },
  { cat:"수학·숫자", title:"최대공약수·최소공배수", emoji:"🔗", name:"gcd_lcm.py", code:
`import math
a, b = 24, 36
g = math.gcd(a, b)
print("최대공약수:", g)
print("최소공배수:", a * b // g)
` },
  { cat:"수학·숫자", title:"진법 변환", emoji:"🔢", name:"진법변환.py", code:
`n = 156
print("2진수:", bin(n))
print("8진수:", oct(n))
print("16진수:", hex(n))
print("2진수 -> 10진수:", int("10011100", 2))
` },
  { cat:"수학·숫자", title:"완전수 찾기", emoji:"💯", name:"완전수.py", code:
`for n in range(2, 1001):
    if sum(i for i in range(1, n) if n % i == 0) == n:
        print(n, "은 완전수")
` },

  // ── 리스트·자료구조 (추가) ──
  { cat:"리스트·자료구조", title:"리스트 컴프리헨션", emoji:"📝", name:"컴프리헨션.py", code:
`squares = [x * x for x in range(1, 11)]
evens = [x for x in range(20) if x % 2 == 0]
pairs = [(x, y) for x in range(3) for y in range(3) if x != y]
print(squares)
print(evens)
print(pairs)
` },
  { cat:"리스트·자료구조", title:"2차원 리스트(행렬)", emoji:"🔲", name:"행렬.py", code:
`matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
for row in matrix:
    print(row)
print("대각합:", sum(matrix[i][i] for i in range(3)))
` },
  { cat:"리스트·자료구조", title:"스택과 큐", emoji:"📚", name:"스택큐.py", code:
`from collections import deque
stack = []
for x in [1, 2, 3]:
    stack.append(x)
print("스택 pop:", stack.pop())

queue = deque(["A", "B", "C"])
print("큐 popleft:", queue.popleft())
` },
  { cat:"리스트·자료구조", title:"중첩 리스트 펼치기", emoji:"➡️", name:"평탄화.py", code:
`nested = [[1, 2], [3, 4, 5], [6]]
flat = [x for row in nested for x in row]
print(flat)
print("합:", sum(flat))
` },
  { cat:"리스트·자료구조", title:"중복 제거·정렬", emoji:"🧹", name:"중복제거.py", code:
`nums = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
unique = sorted(set(nums))
print("원본:", nums)
print("정리:", unique)
` },
  // ── 응용(⭐⭐⭐⭐) / 도전(⭐⭐⭐⭐⭐) ──
  { cat:"응용·도전", title:"다익스트라 최단경로", emoji:"🗺️", name:"다익스트라.py", code:
`import heapq

graph = {
    "A": {"B": 7, "C": 9, "F": 14},
    "B": {"A": 7, "C": 10, "D": 15},
    "C": {"A": 9, "B": 10, "D": 11, "F": 2},
    "D": {"B": 15, "C": 11, "E": 6},
    "E": {"D": 6, "F": 9},
    "F": {"A": 14, "C": 2, "E": 9},
}

def dijkstra(start):
    dist = {node: float("inf") for node in graph}
    dist[start] = 0
    pq = [(0, start)]
    while pq:
        d, node = heapq.heappop(pq)
        if d > dist[node]:
            continue
        for nxt, w in graph[node].items():
            if d + w < dist[nxt]:
                dist[nxt] = d + w
                heapq.heappush(pq, (dist[nxt], nxt))
    return dist

start = "A"
for node, d in dijkstra(start).items():
    print(f"{start} -> {node} : 최단거리 {d}")
` },
  { cat:"응용·도전", title:"배낭 문제 (DP)", emoji:"🎒", name:"배낭문제.py", code:
`weights = [2, 3, 4, 5, 9]
values  = [3, 4, 5, 8, 10]
capacity = 10
n = len(weights)

dp = [[0] * (capacity + 1) for _ in range(n + 1)]
for i in range(1, n + 1):
    for c in range(capacity + 1):
        dp[i][c] = dp[i - 1][c]
        if weights[i - 1] <= c:
            take = dp[i - 1][c - weights[i - 1]] + values[i - 1]
            dp[i][c] = max(dp[i][c], take)

print("최대 가치:", dp[n][capacity])

c, chosen = capacity, []
for i in range(n, 0, -1):
    if dp[i][c] != dp[i - 1][c]:
        chosen.append(i - 1)
        c -= weights[i - 1]
print("담은 물건 index:", sorted(chosen))
` },
  { cat:"응용·도전", title:"최장 공통 부분수열", emoji:"🧬", name:"LCS.py", code:
`a = "AGGTAB"
b = "GXTXAYB"
m, n = len(a), len(b)

dp = [[0] * (n + 1) for _ in range(m + 1)]
for i in range(1, m + 1):
    for j in range(1, n + 1):
        if a[i - 1] == b[j - 1]:
            dp[i][j] = dp[i - 1][j - 1] + 1
        else:
            dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

i, j, lcs = m, n, []
while i > 0 and j > 0:
    if a[i - 1] == b[j - 1]:
        lcs.append(a[i - 1]); i -= 1; j -= 1
    elif dp[i - 1][j] >= dp[i][j - 1]:
        i -= 1
    else:
        j -= 1

print("A:", a)
print("B:", b)
print("최장 공통 부분수열:", "".join(reversed(lcs)), "(길이", dp[m][n], ")")
` },
  { cat:"응용·도전", title:"N-퀸 퍼즐", emoji:"♛", name:"N퀸.py", code:
`N = 8
solutions = 0
cols, diag1, diag2, board = set(), set(), set(), []

def place(row):
    global solutions
    if row == N:
        solutions += 1
        if solutions == 1:
            for c in board:
                print("".join("♛" if x == c else "·" for x in range(N)))
        return
    for col in range(N):
        if col in cols or (row - col) in diag1 or (row + col) in diag2:
            continue
        cols.add(col); diag1.add(row - col); diag2.add(row + col); board.append(col)
        place(row + 1)
        cols.discard(col); diag1.discard(row - col); diag2.discard(row + col); board.pop()

print(f"{N}-퀸 첫 번째 해:")
place(0)
print(f"\\n{N}-퀸 해의 개수: {solutions}")
` },
  { cat:"응용·도전", title:"생명 게임", emoji:"🦠", name:"생명게임.py", code:
`seed = [
    "........",
    "..#.....",
    "...#....",
    ".###....",
    "........",
    "........",
]
grid = [[1 if ch == "#" else 0 for ch in row] for row in seed]
H, W = len(grid), len(grid[0])

def step(g):
    new = [[0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            live = sum(g[(y + dy) % H][(x + dx) % W]
                       for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                       if not (dy == 0 and dx == 0))
            new[y][x] = 1 if (g[y][x] and live in (2, 3)) or (not g[y][x] and live == 3) else 0
    return new

for gen in range(4):
    print(f"세대 {gen}")
    for row in grid:
        print("".join("■" if c else "·" for c in row))
    print()
    grid = step(grid)
` },
  { cat:"응용·도전", title:"만델브로 프랙탈", emoji:"🌀", name:"만델브로.py", code:
`import matplotlib.pyplot as plt

W, H = 300, 200
max_iter = 40
xmin, xmax, ymin, ymax = -2.2, 1.0, -1.2, 1.2

img = [[0] * W for _ in range(H)]
for py in range(H):
    y0 = ymin + (ymax - ymin) * py / H
    for px in range(W):
        x0 = xmin + (xmax - xmin) * px / W
        x = y = 0.0
        it = 0
        while x * x + y * y <= 4 and it < max_iter:
            x, y = x * x - y * y + x0, 2 * x * y + y0
            it += 1
        img[py][px] = it

plt.figure(figsize=(6, 4))
plt.imshow(img, cmap="magma", extent=[xmin, xmax, ymin, ymax])
plt.title("Mandelbrot Set")
plt.axis("off")
plt.show()
` },
  { cat:"응용·도전", title:"허프만 압축", emoji:"🗜️", name:"허프만.py", code:
`import heapq
from collections import Counter

text = "abracadabra abracadabra"
freq = Counter(text)

heap = [[w, [sym, ""]] for sym, w in freq.items()]
heapq.heapify(heap)
while len(heap) > 1:
    lo = heapq.heappop(heap)
    hi = heapq.heappop(heap)
    for pair in lo[1:]:
        pair[1] = "0" + pair[1]
    for pair in hi[1:]:
        pair[1] = "1" + pair[1]
    heapq.heappush(heap, [lo[0] + hi[0]] + lo[1:] + hi[1:])

codes = {sym: code for sym, code in sorted(heap[0][1:], key=lambda p: (len(p[1]), p[0]))}
for sym, code in codes.items():
    print(f"'{'공백' if sym == ' ' else sym}' -> {code}")

encoded = "".join(codes[ch] for ch in text)
print("\\n원본 비트수(8bit):", len(text) * 8)
print("허프만 비트수     :", len(encoded))
print(f"압축률: {len(encoded) / (len(text) * 8) * 100:.1f}%")
` },
  { cat:"응용·도전", title:"수식 계산기 (파서)", emoji:"🧮", name:"수식계산기.py", code:
`import re

def tokenize(s):
    return re.findall(r"\\d+\\.?\\d*|[()+\\-*/]", s)

class Parser:
    def __init__(self, tokens):
        self.toks = tokens
        self.i = 0
    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None
    def take(self):
        t = self.peek(); self.i += 1; return t
    def expr(self):        # 덧셈·뺄셈
        v = self.term()
        while self.peek() in ("+", "-"):
            v = v + self.term() if self.take() == "+" else v - self.term()
        return v
    def term(self):        # 곱셈·나눗셈
        v = self.factor()
        while self.peek() in ("*", "/"):
            v = v * self.factor() if self.take() == "*" else v / self.factor()
        return v
    def factor(self):      # 숫자·괄호
        t = self.take()
        if t == "(":
            v = self.expr(); self.take()   # ')'
            return v
        return float(t)

for e in ["2 + 3 * 4", "(2 + 3) * 4", "10 / 4 - 1", "2 * (3 + (4 - 1))"]:
    print(f"{e} = {Parser(tokenize(e)).expr():g}")
` },
  { cat:"응용·도전", title:"A* 길찾기", emoji:"🧭", name:"a_star.py", code:
`import heapq
import matplotlib.pyplot as plt

grid = [
    "S........",
    ".####.##.",
    ".#...#.#.",
    ".#.#.#.#.",
    "...#...#.",
    ".###.###.",
    ".......#G",
]
H, W = len(grid), len(grid[0])
walls, start, goal = set(), None, None
for y, row in enumerate(grid):
    for x, ch in enumerate(row):
        if ch == "#": walls.add((x, y))
        elif ch == "S": start = (x, y)
        elif ch == "G": goal = (x, y)

def heuristic(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

pq = [(heuristic(start, goal), 0, start)]
came, gscore = {}, {start: 0}
while pq:
    _, g, cur = heapq.heappop(pq)
    if cur == goal:
        break
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = cur[0] + dx, cur[1] + dy
        if not (0 <= nx < W and 0 <= ny < H) or (nx, ny) in walls:
            continue
        ng = g + 1
        if ng < gscore.get((nx, ny), 10 ** 9):
            gscore[(nx, ny)] = ng
            came[(nx, ny)] = cur
            heapq.heappush(pq, (ng + heuristic((nx, ny), goal), ng, (nx, ny)))

path, node = [], goal
while node in came:
    path.append(node); node = came[node]
path.append(start); path.reverse()
print("경로 길이:", len(path))

img = [[1 if (x, y) in walls else 0 for x in range(W)] for y in range(H)]
for (x, y) in path:
    img[y][x] = 2
plt.figure(figsize=(6, 3.6))
plt.imshow(img, cmap="viridis")
plt.title(f"A* path length = {len(path)}")
plt.axis("off")
plt.show()
` },
  { cat:"응용·도전", title:"마르코프 문장 생성", emoji:"📝", name:"마르코프.py", code:
`import random
random.seed(7)

corpus = """
파이썬은 배우기 쉽고 강력한 언어입니다.
파이썬은 데이터 분석에 자주 쓰입니다.
데이터 분석은 재미있고 유용합니다.
파이썬으로 웹도 만들고 게임도 만듭니다.
""".split()

model = {}
for a, b in zip(corpus, corpus[1:]):
    model.setdefault(a, []).append(b)

word = random.choice(corpus)
sentence = [word]
for _ in range(12):
    nexts = model.get(word)
    if not nexts:
        break
    word = random.choice(nexts)
    sentence.append(word)

print("생성된 문장:")
print(" ".join(sentence))
` },
];

// ===== 예제 학습 메타데이터 =====
// 각 예제에 난이도(level 1~5)·한 줄 설명(desc)·배우는 개념(learn)을 더한다.
// 코드 블록을 건드리지 않도록 PY_SNIPPETS 와 "같은 순서"의 병렬 배열로 두고 아래에서 병합한다.
//   l: 1=입문 · 2=기본 · 3=심화 · 4=응용 · 5=도전   d: 한 줄 설명   t: 배우는 개념 태그
// ⚠ 예제를 추가·재배치하면 이 배열의 순서도 함께 맞춰야 한다(개수가 다르면 있는 만큼만 병합).
const PY_SNIPPET_META = [
  { l:1, d:"변수에 값을 담고 print로 화면에 출력해요.", t:["변수","print()"] },
  { l:1, d:"input()으로 입력을 받아 f-문자열로 인사해요.", t:["input()","f-문자열"] },
  { l:1, d:"+, -, *, //, %, / 연산자로 계산해요.", t:["산술 연산자","몫·나머지"] },
  { l:1, d:"a, b = b, a 한 줄로 두 값을 맞바꿔요.", t:["다중 할당","튜플 언패킹"] },
  { l:1, d:"int(), float(), str()로 자료형을 바꿔요.", t:["형변환","type()"] },
  { l:1, d:"이중 for문으로 2~9단을 출력해요.", t:["이중 반복문","range()"] },
  { l:1, d:"문자열 곱셈으로 별을 쌓아 삼각형을 만들어요.", t:["for문","문자열 곱셈"] },
  { l:1, d:"range의 감소 스텝으로 별을 줄여가요.", t:["range() 역순","문자열 곱셈"] },
  { l:2, d:"증가·감소 구간을 이어 붙여 마름모를 그려요.", t:["리스트 이어붙이기","패턴 출력"] },
  { l:1, d:"sum()과 range()로 연속된 수를 더해요.", t:["sum()","range()"] },
  { l:2, d:"컴프리헨션과 나머지 연산으로 수를 분류해요.", t:["리스트 컴프리헨션","나머지 연산"] },
  { l:2, d:"제곱근까지만 나눠보며 소수를 판별해요.", t:["함수","소수 판별"] },
  { l:1, d:"math.factorial로 1!~7!을 구해요.", t:["math 모듈","반복문"] },
  { l:2, d:"math.gcd로 최대공약수·최소공배수를 구해요.", t:["math.gcd","약수 관계"] },
  { l:1, d:"나머지가 0인 수만 모아 약수를 찾아요.", t:["리스트 컴프리헨션","나머지 연산"] },
  { l:1, d:"bin/oct/hex로 2·8·16진수로 바꿔요.", t:["진법","내장 함수"] },
  { l:2, d:"라이프니츠 급수를 더해 원주율을 근사해요.", t:["급수","반복 누적"] },
  { l:1, d:"슬라이싱 [::-1]로 문자열을 뒤집어요.", t:["슬라이싱","문자열"] },
  { l:2, d:"뒤집어도 같은지 비교해 회문을 판별해요.", t:["함수","슬라이싱"] },
  { l:2, d:"제너레이터로 모음 글자만 세요.", t:["문자열 순회","조건 카운트"] },
  { l:1, d:"upper·lower·swapcase·title 메서드를 써요.", t:["문자열 메서드"] },
  { l:2, d:"Counter로 단어 개수를 한 번에 세요.", t:["collections.Counter","split()"] },
  { l:1, d:"ord()와 chr()로 문자↔코드값을 바꿔요.", t:["ord()","chr()"] },
  { l:1, d:"sorted()로 오름·내림차순 정렬해요.", t:["sorted()","reverse"] },
  { l:1, d:"max·min·sum으로 점수 통계를 내요.", t:["max()","min()","평균"] },
  { l:1, d:"set으로 중복을 없애고 정렬해요.", t:["set","중복 제거"] },
  { l:1, d:"키-값으로 전화번호부를 만들고 순회해요.", t:["딕셔너리","items()"] },
  { l:2, d:"한 줄로 제곱 리스트를 만들어요.", t:["리스트 컴프리헨션"] },
  { l:2, d:"zip(*matrix)로 행과 열을 바꿔요.", t:["zip()","언패킹"] },
  { l:1, d:"random.sample로 겹치지 않는 6개를 뽑아요.", t:["random.sample","정렬"] },
  { l:1, d:"random.randint로 주사위를 굴려요.", t:["random.randint","반복"] },
  { l:1, d:"random.choice로 무작위로 한 손을 골라요.", t:["random.choice"] },
  { l:2, d:"while로 반복 입력받아 up/down을 알려줘요.", t:["while문","break","input()"] },
  { l:2, d:"1000번 던져 앞·뒤 횟수를 세요.", t:["리스트 컴프리헨션","count()"] },
  { l:2, d:"문자 집합에서 무작위로 골라 비밀번호를 만들어요.", t:["string 모듈","join()"] },
  { l:1, d:"datetime.now와 strftime으로 시각을 꾸며요.", t:["datetime","strftime"] },
  { l:1, d:"calendar.month로 달력을 출력해요.", t:["calendar 모듈"] },
  { l:1, d:"weekday()로 오늘 요일을 구해요.", t:["datetime","리스트 인덱싱"] },
  { l:2, d:"두 날짜를 빼서 남은 일수를 구해요.", t:["날짜 뺄셈","timedelta"] },
  { l:2, d:"생일이 지났는지 비교해 만 나이를 구해요.", t:["튜플 비교","조건식"] },
  { l:2, d:"a,b = b,a+b로 다음 항을 이어 만들어요.", t:["반복","다중 할당"] },
  { l:2, d:"이웃끼리 비교·교환을 반복해 정렬해요.", t:["이중 반복문","교환 정렬"] },
  { l:2, d:"정렬된 데이터를 절반씩 좁혀 찾아요.", t:["이진 탐색","while문"] },
  { l:3, d:"재귀로 원반 옮기는 순서를 출력해요.", t:["재귀","분할 정복"] },
  { l:1, d:"배수 조건으로 Fizz/Buzz를 출력해요.", t:["조건문","나머지 연산"] },
  { l:2, d:"matplotlib bar로 막대 그래프를 그려요.", t:["matplotlib","bar()"] },
  { l:2, d:"plot으로 y=x² 곡선을 그려요.", t:["matplotlib","plot()"] },
  { l:2, d:"pie로 비율을 원그래프로 보여줘요.", t:["matplotlib","pie()"] },
  { l:2, d:"math.sin 값을 이어 곡선을 그려요.", t:["matplotlib","math.sin"] },
  { l:3, d:"numpy 격자에 곡면을 3D로 그려요.", t:["numpy","3D 그래프"] },
  { l:3, d:"무작위 점을 3D 공간에 흩뿌려요.", t:["numpy","3D 산점도"] },
  { l:3, d:"cos·sin·t로 나선을 3D로 그려요.", t:["numpy","3D 곡선"] },
  { l:1, d:"선 문자를 조합해 글자 상자를 만들어요.", t:["문자열 곱셈","출력 꾸미기"] },
  { l:1, d:"def로 함수를 만들고 기본값 인자를 써요.", t:["def","기본값 인자","return"] },
  { l:2, d:"*args, **kwargs로 개수가 다른 인자를 받아요.", t:["*args","**kwargs"] },
  { l:2, d:"자기 자신을 부르는 재귀로 팩토리얼을 구해요.", t:["재귀","종료 조건"] },
  { l:2, d:"재귀로 피보나치 수를 구해요.", t:["재귀","피보나치"] },
  { l:3, d:"재귀로 원반 이동을 단계별로 출력해요.", t:["재귀","분할 정복"] },
  { l:2, d:"익명 함수로 리스트를 변환·선별해요.", t:["lambda","map()","filter()"] },
  { l:1, d:"과목별 점수를 저장하고 평균을 내요.", t:["딕셔너리","values()"] },
  { l:2, d:"Counter.most_common으로 많이 나온 순으로 봐요.", t:["Counter","most_common()"] },
  { l:2, d:"합·교·차집합을 기호로 계산해요.", t:["set","집합 연산"] },
  { l:2, d:"key=lambda로 값 기준으로 정렬해요.", t:["sorted() key","lambda"] },
  { l:2, d:"딕셔너리 안 딕셔너리로 학생별 성적을 다뤄요.", t:["중첩 자료구조","평균"] },
  { l:1, d:"get()으로 글자별 개수를 세요.", t:["dict.get()","카운팅"] },
  { l:2, d:"형변환 오류를 예외로 안전하게 처리해요.", t:["try/except","ValueError"] },
  { l:1, d:"ZeroDivisionError를 잡아 안내해요.", t:["try/except","ZeroDivisionError"] },
  { l:2, d:"변환 실패 시 None을 돌려주는 함수예요.", t:["예외 처리","None 반환"] },
  { l:2, d:"예외 종류별로 다르게 처리해요.", t:["다중 except"] },
  { l:2, d:"성공·실패와 상관없이 finally를 실행해요.", t:["finally","IndexError"] },
  { l:2, d:"class로 객체를 만들고 메서드를 호출해요.", t:["class","__init__","메서드"] },
  { l:2, d:"입금 메서드와 __str__로 상태를 표현해요.", t:["class","__str__"] },
  { l:3, d:"부모 클래스를 물려받아 speak를 재정의해요.", t:["상속","오버라이딩"] },
  { l:3, d:"두 점 사이 거리를 메서드로 계산해요.", t:["class","거리 공식"] },
  { l:3, d:"@dataclass로 데이터 클래스를 간단히 만들어요.", t:["dataclass","타입 힌트"] },
  { l:2, d:"이웃 비교·교환으로 정렬해요.", t:["버블 정렬","이중 반복"] },
  { l:2, d:"가장 작은 값을 앞으로 골라 정렬해요.", t:["선택 정렬","최솟값"] },
  { l:2, d:"절반씩 좁혀 값을 찾아요.", t:["이진 탐색","while문"] },
  { l:2, d:"(나이, 이름) 튜플 키로 여러 기준 정렬해요.", t:["튜플 키 정렬"] },
  { l:1, d:"반복하며 직접 최대·최소를 갱신해요.", t:["반복","비교"] },
  { l:2, d:"random.random으로 앞면 비율을 실험해요.", t:["확률","시뮬레이션"] },
  { l:2, d:"두 주사위 합의 분포를 막대로 그려요.", t:["딕셔너리 카운트","시뮬레이션"] },
  { l:3, d:"무작위 점으로 원주율을 추정해요.", t:["몬테카를로","확률"] },
  { l:3, d:"무작위로 걸으며 경로를 그려요.", t:["시뮬레이션","matplotlib"] },
  { l:3, d:"생일이 겹칠 확률을 실험으로 확인해요.", t:["확률 실험","set"] },
  { l:2, d:"10판 대결 결과를 딕셔너리로 집계해요.", t:["딕셔너리","승패 판정"] },
  { l:2, d:"정규분포 점을 흩뿌려 그려요.", t:["matplotlib","scatter()"] },
  { l:2, d:"값의 분포를 막대로 나눠 그려요.", t:["matplotlib","hist()"] },
  { l:2, d:"두 곡선을 겹쳐 그리고 범례를 달아요.", t:["matplotlib","legend()"] },
  { l:2, d:"barh로 가로 막대 그래프를 그려요.", t:["matplotlib","barh()"] },
  { l:2, d:"fill_between으로 곡선 아래를 칠해요.", t:["matplotlib","fill_between()"] },
  { l:2, d:"subplots로 그래프 두 개를 나란히 그려요.", t:["matplotlib","subplots()"] },
  { l:1, d:"슬라이싱으로 여러 단어의 회문을 확인해요.", t:["슬라이싱","조건식"] },
  { l:1, d:"모음 글자를 세어 개수를 구해요.", t:["문자열 순회","카운트"] },
  { l:3, d:"글자를 일정 칸 밀어 암호로 바꿔요.", t:["ord()/chr()","모듈러 연산"] },
  { l:2, d:"단어 순서와 글자 순서를 각각 뒤집어요.", t:["split()","reversed()"] },
  { l:2, d:"대문자·소문자·숫자 개수를 세요.", t:["문자열 판별 메서드"] },
  { l:3, d:"체를 걸러 소수를 빠르게 찾아요.", t:["에라토스테네스의 체","리스트 활용"] },
  { l:1, d:"약수를 모아 개수까지 구해요.", t:["리스트 컴프리헨션","약수"] },
  { l:2, d:"math.gcd로 두 수의 gcd·lcm을 구해요.", t:["math.gcd","lcm"] },
  { l:2, d:"2·8·16진수 변환과 문자열→10진수도 해봐요.", t:["진법 변환","int(x, base)"] },
  { l:2, d:"진약수의 합이 자기 자신인 수를 찾아요.", t:["약수 합","조건 판별"] },
  { l:2, d:"조건·이중 반복 컴프리헨션을 익혀요.", t:["리스트 컴프리헨션","이중 반복"] },
  { l:2, d:"행렬을 순회하고 대각선 합을 구해요.", t:["2차원 리스트","인덱싱"] },
  { l:2, d:"리스트와 deque로 스택·큐를 다뤄요.", t:["스택","큐","deque"] },
  { l:2, d:"이중 컴프리헨션으로 리스트를 평탄화해요.", t:["평탄화","이중 반복"] },
  { l:1, d:"set으로 중복을 없애고 정렬해요.", t:["set","정렬"] },
  // ── 응용(4) / 도전(5) ── (PY_SNIPPETS 끝에 추가한 10개와 같은 순서)
  { l:4, d:"우선순위 큐로 그래프의 최단거리를 구해요.", t:["다익스트라","heapq","그래프"] },
  { l:4, d:"동적계획법으로 0/1 배낭 문제를 풀고 담은 물건을 역추적해요.", t:["동적계획법","2차원 DP"] },
  { l:4, d:"DP 표로 최장 공통 부분수열을 찾고 문자열을 복원해요.", t:["동적계획법","문자열 DP"] },
  { l:4, d:"백트래킹과 가지치기로 N-퀸의 모든 해를 세요.", t:["백트래킹","재귀","가지치기"] },
  { l:4, d:"콘웨이 생명 게임을 세대별로 진행하며 규칙을 관찰해요.", t:["셀룰러 오토마타","2차원 리스트"] },
  { l:5, d:"복소수 반복 발산 횟수로 만델브로 프랙탈을 그려요.", t:["프랙탈","복소평면","imshow()"] },
  { l:5, d:"빈도 기반 허프만 코드를 만들어 압축률을 계산해요.", t:["허프만 코딩","heapq","트리"] },
  { l:5, d:"재귀 하강 파서로 괄호·연산자 우선순위를 계산해요.", t:["파서","재귀 하강","연산자 우선순위"] },
  { l:5, d:"맨해튼 휴리스틱을 쓰는 A*로 격자 미로 경로를 찾아요.", t:["A* 탐색","휴리스틱","경로 복원"] },
  { l:5, d:"마르코프 체인으로 다음 단어를 이어 문장을 생성해요.", t:["마르코프 체인","확률 모델"] },
];
// PY_SNIPPETS 에 학습 메타데이터를 병합(순서 기준). 개수가 어긋나도 있는 만큼만 안전하게 채운다.
PY_SNIPPETS.forEach((s, i) => {
  const m = PY_SNIPPET_META[i];
  if (!m) return;
  if (s.level === undefined) s.level = m.l;
  if (s.desc === undefined) s.desc = m.d;
  if (s.learn === undefined) s.learn = m.t;
});

const SNIPPET_LEVELS = { 1: { label: "입문", star: "⭐" }, 2: { label: "기본", star: "⭐⭐" }, 3: { label: "심화", star: "⭐⭐⭐" }, 4: { label: "응용", star: "⭐⭐⭐⭐" }, 5: { label: "도전", star: "⭐⭐⭐⭐⭐" } };

function openPythonSnippet(snip){
  handleFiles([new File([snip.code], snip.name, { type: "text/x-python" })]);
}

function openSnippetGallery(){
  if (document.querySelector(".snippet-modal")) return;          // 중복 열림 방지
  const modal = document.createElement("div"); modal.className = "modal snippet-modal";
  const card = document.createElement("div"); card.className = "modal-card";
  const h = document.createElement("h3"); h.textContent = "파이썬 예제 갤러리";
  const sub = document.createElement("div"); sub.className = "sub";
  sub.textContent = "예제 " + PY_SNIPPETS.length + "개 · 난이도로 고르고 클릭하면 새 코드로 열려요. ▶ 실행(" + shortcutDisplay(shortcutValue("runCode")) + ")으로 바로 돌려보세요.";
  const close = () => { window.removeEventListener("keydown", onKey, true); modal.remove(); };
  const onKey = (e) => { if (e.key === "Escape"){ e.preventDefault(); close(); } };

  // 검색창: 제목·카테고리·설명·개념·파일명으로 빠르게 거르기(예제가 많아짐)
  const search = document.createElement("input"); search.type = "search"; search.className = "snippet-search";
  search.placeholder = "예제 검색 (제목·설명·개념)"; search.setAttribute("aria-label", "예제 검색");

  // 난이도 필터 칩: 전체 / ⭐ 입문 / ⭐⭐ 기본 / ⭐⭐⭐ 심화 / ⭐⭐⭐⭐ 응용 / ⭐⭐⭐⭐⭐ 도전
  let levelFilter = 0;   // 0 = 전체
  const filterBar = document.createElement("div"); filterBar.className = "snippet-filter"; filterBar.setAttribute("role", "group"); filterBar.setAttribute("aria-label", "난이도 필터");
  const countFor = (lv) => PY_SNIPPETS.filter(s => !lv || s.level === lv).length;
  const chipDefs = [{ lv: 0, text: "전체 " + countFor(0) }].concat(
    [1, 2, 3, 4, 5].map(lv => ({ lv, text: SNIPPET_LEVELS[lv].star + " " + SNIPPET_LEVELS[lv].label + " " + countFor(lv) }))
  );
  const chips = chipDefs.map(def => {
    const chip = document.createElement("button"); chip.type = "button"; chip.className = "snippet-chip"; chip.textContent = def.text;
    chip.setAttribute("aria-pressed", def.lv === 0 ? "true" : "false");
    if (def.lv === 0) chip.classList.add("active");
    chip.addEventListener("click", () => {
      levelFilter = def.lv;
      chips.forEach(c => { const on = (c === chip); c.classList.toggle("active", on); c.setAttribute("aria-pressed", on ? "true" : "false"); });
      applyFilter();
    });
    filterBar.appendChild(chip);
    return chip;
  });

  // 카테고리별로 묶어 헤더 + 카드 그리드로 렌더(긴 목록은 본문 스크롤)
  const body = document.createElement("div"); body.className = "snippet-body";
  const sections = [];
  const cats = [], byCat = new Map();
  PY_SNIPPETS.forEach(s => { const c = s.cat || "기타"; if (!byCat.has(c)){ byCat.set(c, []); cats.push(c); } byCat.get(c).push(s); });
  cats.forEach(c => {
    const head = document.createElement("div"); head.className = "snippet-cat"; head.textContent = c;
    const grid = document.createElement("div"); grid.className = "snippet-grid";
    const cards = [];
    byCat.get(c).forEach(s => {
      const lvInfo = SNIPPET_LEVELS[s.level] || null;
      const b = document.createElement("button"); b.type = "button"; b.className = "snippet-card"; b.title = s.name;
      if (lvInfo){ b.classList.add("lv" + s.level); b.setAttribute("aria-label", s.title + " · " + lvInfo.label + " · " + (s.desc || "")); }
      const top = document.createElement("span"); top.className = "snippet-top";
      const em = document.createElement("span"); em.className = "snippet-emoji"; em.textContent = s.emoji;
      top.appendChild(em);
      if (lvInfo){ const lv = document.createElement("span"); lv.className = "snippet-level"; lv.textContent = lvInfo.star; lv.title = lvInfo.label; top.appendChild(lv); }
      const t = document.createElement("span"); t.className = "snippet-title"; t.textContent = s.title;
      b.append(top, t);
      if (s.desc){ const d = document.createElement("span"); d.className = "snippet-desc"; d.textContent = s.desc; b.appendChild(d); }
      if (Array.isArray(s.learn) && s.learn.length){
        const tags = document.createElement("span"); tags.className = "snippet-tags";
        s.learn.slice(0, 3).forEach(name => { const tag = document.createElement("span"); tag.className = "snippet-tag"; tag.textContent = name; tags.appendChild(tag); });
        b.appendChild(tags);
      }
      b.addEventListener("click", () => { close(); openPythonSnippet(s); });
      grid.appendChild(b);
      cards.push({ el: b, level: s.level || 0, hay: (s.title + " " + c + " " + (s.desc || "") + " " + (Array.isArray(s.learn) ? s.learn.join(" ") : "") + " " + (s.name || "")).toLocaleLowerCase() });
    });
    body.append(head, grid);
    sections.push({ head, grid, cards });
  });
  const emptyMsg = document.createElement("div"); emptyMsg.className = "snippet-empty"; emptyMsg.textContent = "조건에 맞는 예제가 없어요."; emptyMsg.hidden = true;
  body.appendChild(emptyMsg);
  const applyFilter = () => {
    const q = search.value.trim().toLocaleLowerCase();
    let any = false;
    sections.forEach(sec => {
      let shown = 0;
      sec.cards.forEach(c => {
        const ok = (!q || c.hay.includes(q)) && (!levelFilter || c.level === levelFilter);
        c.el.hidden = !ok; if (ok) shown++;
      });
      sec.head.hidden = sec.grid.hidden = (shown === 0);
      if (shown) any = true;
    });
    emptyMsg.hidden = any;
  };
  search.addEventListener("input", applyFilter);

  const actions = document.createElement("div"); actions.className = "modal-actions";
  const spacer = document.createElement("div"); spacer.className = "spacer";
  const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "닫기";
  cancel.addEventListener("click", close);
  actions.append(spacer, cancel);
  card.append(h, sub, search, filterBar, body, actions);
  modal.appendChild(card);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });   // 바깥 클릭 닫기
  document.body.appendChild(modal);
  setTimeout(() => { try { search.focus(); } catch(e){} }, 0);   // 열면 바로 검색 가능
  window.addEventListener("keydown", onKey, true);
}

// 편집 가능한 코드 에디터: 투명 textarea(실제 입력) 아래에 구문강조 pre(표시)를 겹쳐, 색을 유지하며 편집.
// 줄번호·스크롤 동기화, Tab=공백 4칸. getValue()로 현재 내용을 읽는다(저장 기능은 없음 — 실시간 편집+실행).
// ===== Jedi(로컬 파이썬) 문맥 자동완성 — 가능할 때만, 안 되면 로컬 완성으로 폴백 =====
let _jediBackend = null;   // null=미확인 | "pending" | true | false
function ensureJediProbe(){
  if (_jediBackend !== null) return;                       // 한 번만 확인(결과 캐시)
  if (location.protocol !== "http:" && location.protocol !== "https:"){ _jediBackend = false; return; }
  _jediBackend = "pending";
  fetch("/can-complete", { method: "GET" })                // 백그라운드: 로컬 파이썬+Jedi 준비(없으면 서버가 1회 설치)
    .then(res => res.ok ? res.text() : "no")
    .then(t => { _jediBackend = (String(t).trim().toLowerCase() === "yes"); })
    .catch(() => { _jediBackend = false; });
}
const jediReady = () => _jediBackend === true;
async function requestJediCompletions(source, line, column){
  try {
    const res = await fetch("/complete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, line, column }) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.ok === false || !Array.isArray(data.items)) return null;
    return data.items.map(it => {
      const name = (it && it.name) ? String(it.name) : "";
      if (!name) return null;
      return {
        name,
        type: String(it.type || ""),
        signature: String(it.signature || "").slice(0, 700)
      };
    }).filter(Boolean);
  } catch(e){ return null; }
}
async function requestJediHelp(source, line, column){
  const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 8000) : 0;   // 응답이 없으면 8초 후 포기(로딩 무한대기 방지)
  try {
    const res = await fetch("/complete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, line, column, mode: "help" }), signal: controller ? controller.signal : undefined });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.ok === false) return null;
    return {
      ok: true,
      name: String(data.name || ""),
      type: String(data.type || ""),
      signature: String(data.signature || "").slice(0, 400),
      docstring: String(data.docstring || "").slice(0, 4000)
    };
  } catch(e){ return null; }
  finally { if (timer) clearTimeout(timer); }
}
async function requestJediDefinition(source, line, column){
  try {
    const res = await fetch("/definition", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, line, column, mode: "definition" }) });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : data || null;
  } catch(e){ return null; }
}
async function readLocalDefinitionFile(path){
  // Jedi가 C 확장 모듈(.dll/.pyd 등)을 정의 위치로 돌려주는 경우가 있다.
  // 앱에서 열 수 있는 텍스트 소스만 요청해 예상된 404와 빈 탭 생성을 막는다.
  if (!/\.(py|pyw|pyi|txt)$/i.test(String(path || ""))) return null;
  try {
    const res = await fetch("/local-file?path=" + encodeURIComponent(path));
    if (!res.ok || res.status === 204) return null;
    const buffer = await res.arrayBuffer();
    return buffer.byteLength ? buffer : null;
  } catch(e){ return null; }
}

