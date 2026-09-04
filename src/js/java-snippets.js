"use strict";

// ===== 자바 예제 갤러리: 클릭하면 새 코드로 열려 바로 ▶ 실행해볼 수 있다 =====
// 그리는 쪽은 snippet-gallery.js — 여기에는 목록만 둔다.
// 규칙(docs/자바-예제갤러리-설계.md):
//   · name 은 코드의 public 클래스 이름과 같아야 하고 영문 대문자로 시작한다(java-editor.js 의 파일명 검사).
//   · 문법은 Java 11 까지만 쓴다 — 학생 PC 에 남아 있는 JDK 11/17 로도 컴파일되어야 한다.
//     (record · switch 식 · 텍스트 블록 금지)
//   · 한 예제 = 한 파일, main 은 파일당 하나. 보조 클래스는 같은 파일 안 비-public 클래스로 둔다.
//   · JDK 클래스와 같은 이름은 쓰지 않는다(예: DayOfWeek → WeekdayFinder).
//   · level/desc/learn 은 병렬 배열을 쓰지 않고 각 예제 안에 바로 적는다.
// 코드 문자열은 들여쓰기 보존을 위해 템플릿 리터럴의 각 줄을 0칸에서 시작한다.
// tests/java-snippets.test.js 가 이름·클래스·금지 문법을 검사한다.
const JAVA_SNIPPETS = [
  // ── 기초 / 출력 ──
  { cat:"기초·출력", title:"Hello, Java", name:"HelloJava.java", level:1, pair:"hello",
    desc:"클래스와 main 틀 안에서 println 으로 한 줄 출력해요.", learn:["class","main()","println"], code:
`public class HelloJava {
    public static void main(String[] args) {
        String name = "자바";
        System.out.println("Hello, " + name);
        System.out.println("환영합니다!");
    }
}
` },
  { cat:"기초·출력", title:"이름 인사 (입력)", name:"Greeting.java", level:1, pair:"greeting",
    desc:"Scanner 로 이름을 입력받아 인사말을 만들어요.", learn:["Scanner","nextLine()","문자열 연결"], code:
`import java.util.Scanner;

public class Greeting {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("이름이 뭐예요? ");
        String name = sc.nextLine();
        System.out.println("반가워요, " + name + "님!");
    }
}
` },
  { cat:"기초·출력", title:"사칙연산", name:"Arithmetic.java", level:1, pair:"arithmetic",
    desc:"+, -, *, /, % 로 계산하고 정수 나눗셈의 몫을 확인해요.", learn:["산술 연산자","정수 나눗셈","나머지"], code:
`public class Arithmetic {
    public static void main(String[] args) {
        int a = 17, b = 5;
        System.out.println("합: " + (a + b));
        System.out.println("차: " + (a - b));
        System.out.println("곱: " + (a * b));
        System.out.println("몫: " + (a / b) + ", 나머지: " + (a % b));
        System.out.println("실수 나눗셈: " + ((double) a / b));
    }
}
` },
  { cat:"기초·출력", title:"변수와 자료형", name:"VarTypes.java", level:1,
    desc:"int·double·boolean·char 를 선언하고 값을 넣어 봐요.", learn:["기본 자료형","변수 선언"], code:
`public class VarTypes {
    public static void main(String[] args) {
        int age = 17;
        double height = 172.5;
        boolean student = true;
        char grade = 'A';
        String name = "홍길동";

        System.out.println("이름: " + name);
        System.out.println("나이: " + age + " (int)");
        System.out.println("키: " + height + " (double)");
        System.out.println("학생인가요? " + student + " (boolean)");
        System.out.println("등급: " + grade + " (char)");
        System.out.println("int 에는 " + Integer.MIN_VALUE + " ~ " + Integer.MAX_VALUE + " 까지 담을 수 있어요.");
    }
}
` },
  { cat:"기초·출력", title:"형변환", name:"TypeCast.java", level:1, pair:"typecast",
    desc:"(int) 캐스팅과 Integer.parseInt 로 자료형을 바꿔요.", learn:["형변환","Integer.parseInt()","String.valueOf()"], code:
`public class TypeCast {
    public static void main(String[] args) {
        String s = "123";
        int n = Integer.parseInt(s);
        System.out.println(n + 1);

        double d = 3.9;
        int cut = (int) d;                 // 소수점 아래는 버린다(반올림이 아니다)
        System.out.println(d + " -> " + cut);

        int a = 7, b = 2;
        System.out.println("정수끼리 나누면: " + (a / b));
        System.out.println("실수로 바꿔 나누면: " + ((double) a / b));
        System.out.println("숫자를 글자로: " + String.valueOf(20) + "살");
    }
}
` },
  { cat:"기초·출력", title:"두 값 교환", name:"SwapValues.java", level:1, pair:"swap",
    desc:"임시 변수를 하나 두어 두 값을 맞바꿔요.", learn:["임시 변수","대입 순서"], code:
`public class SwapValues {
    public static void main(String[] args) {
        int a = 1, b = 2;
        System.out.println("전: a=" + a + ", b=" + b);

        int temp = a;      // 파이썬의 a, b = b, a 와 달리 임시 변수가 필요하다
        a = b;
        b = temp;

        System.out.println("후: a=" + a + ", b=" + b);
    }
}
` },
  { cat:"기초·출력", title:"출력 서식", name:"PrintFormat.java", level:1,
    desc:"printf 의 %d·%s·%.2f 로 자리를 맞춰 출력해요.", learn:["printf()","서식 지정자","print vs println"], code:
`public class PrintFormat {
    public static void main(String[] args) {
        String name = "홍길동";
        int score = 92;
        double average = 87.6666;

        System.out.print("print 는 ");
        System.out.print("줄을 바꾸지 않아요.");
        System.out.println();                        // 여기서 한 줄 내린다

        System.out.printf("%s 님의 점수는 %d 점입니다.%n", name, score);
        System.out.printf("평균: %.2f%n", average);
        System.out.printf("[%10s][%-10s]%n", "오른쪽", "왼쪽");
        System.out.printf("빈 자리를 0으로: %05d%n", 42);
    }
}
` },

  // ── 반복 / 패턴 ──
  { cat:"반복·패턴", title:"구구단", name:"TimesTable.java", level:1, pair:"gugudan",
    desc:"이중 for 문으로 2~9단을 출력해요.", learn:["이중 반복문","for"], code:
`public class TimesTable {
    public static void main(String[] args) {
        for (int dan = 2; dan <= 9; dan++) {
            System.out.println("--- " + dan + "단 ---");
            for (int i = 1; i <= 9; i++) {
                System.out.println(dan + " x " + i + " = " + (dan * i));
            }
        }
    }
}
` },
  { cat:"반복·패턴", title:"별 피라미드", name:"StarPyramid.java", level:1, pair:"star-pyramid",
    desc:"안쪽 반복으로 공백과 별을 찍어 삼각형을 쌓아요.", learn:["중첩 for","공백 출력"], code:
`public class StarPyramid {
    public static void main(String[] args) {
        int n = 5;
        for (int i = 1; i <= n; i++) {
            for (int s = 0; s < n - i; s++) System.out.print(" ");    // 파이썬의 " " * n 대신 반복
            for (int j = 0; j < 2 * i - 1; j++) System.out.print("*");
            System.out.println();
        }
    }
}
` },
  { cat:"반복·패턴", title:"역삼각형 별", name:"StarReverse.java", level:1, pair:"star-reverse",
    desc:"감소하는 for 로 별을 한 줄씩 줄여요.", learn:["역순 반복"], code:
`public class StarReverse {
    public static void main(String[] args) {
        int n = 5;
        for (int i = n; i >= 1; i--) {
            for (int j = 0; j < i; j++) System.out.print("*");
            System.out.println();
        }
    }
}
` },
  { cat:"반복·패턴", title:"다이아몬드 별", name:"StarDiamond.java", level:2, pair:"star-diamond",
    desc:"늘어나는 부분과 줄어드는 부분을 이어 마름모를 그려요.", learn:["중첩 반복","패턴 출력"], code:
`public class StarDiamond {
    public static void main(String[] args) {
        int n = 4;
        for (int i = 1; i <= n; i++) printLine(n, i);        // 점점 넓어지고
        for (int i = n - 1; i >= 1; i--) printLine(n, i);    // 다시 좁아진다
    }

    static void printLine(int n, int i) {
        for (int s = 0; s < n - i; s++) System.out.print(" ");
        for (int j = 0; j < 2 * i - 1; j++) System.out.print("*");
        System.out.println();
    }
}
` },
  { cat:"반복·패턴", title:"1~100 합계", name:"SumToHundred.java", level:1, pair:"sum-100",
    desc:"반복하며 변수에 더해 1부터 100까지의 합을 구해요.", learn:["누적 변수","for","while"], code:
`public class SumToHundred {
    public static void main(String[] args) {
        int total = 0;
        for (int i = 1; i <= 100; i++) total += i;
        System.out.println("1부터 100까지 합: " + total);

        int sum = 0, i = 1;
        while (i <= 100) {
            sum += i;
            i++;
        }
        System.out.println("while 로 구해도: " + sum);
    }
}
` },
  { cat:"반복·패턴", title:"짝수/홀수 나누기", name:"EvenOdd.java", level:2, pair:"even-odd",
    desc:"나머지로 짝·홀을 갈라 ArrayList 두 개에 담아요.", learn:["나머지 연산","ArrayList"], code:
`import java.util.ArrayList;
import java.util.List;

public class EvenOdd {
    public static void main(String[] args) {
        List<Integer> evens = new ArrayList<>();
        List<Integer> odds = new ArrayList<>();

        for (int n = 1; n <= 20; n++) {
            if (n % 2 == 0) evens.add(n);
            else odds.add(n);
        }
        System.out.println("짝수: " + evens);
        System.out.println("홀수: " + odds);
    }
}
` },
  { cat:"반복·패턴", title:"while 과 do-while", name:"WhileLoop.java", level:2,
    desc:"두 반복문의 차이를 보고 break·continue 를 써 봐요.", learn:["while","do-while","break","continue"], code:
`public class WhileLoop {
    public static void main(String[] args) {
        System.out.println("--- while: 조건을 먼저 본다 ---");
        int n = 5;
        while (n > 0) {
            System.out.print(n + " ");
            n--;
        }
        System.out.println();

        System.out.println("--- do-while: 일단 한 번은 한다 ---");
        int m = 0;
        do {
            System.out.println("조건이 " + (m > 0) + " 여도 한 번은 실행돼요.");
            m--;
        } while (m > 0);

        System.out.println("--- break / continue ---");
        for (int i = 1; i <= 10; i++) {
            if (i % 2 == 0) continue;      // 짝수는 건너뛰고
            if (i > 7) break;              // 7을 넘으면 그만
            System.out.print(i + " ");
        }
        System.out.println();
    }
}
` },

  // ── 수학 / 숫자 ──
  { cat:"수학·숫자", title:"소수 찾기", name:"PrimeNumbers.java", level:2, pair:"prime",
    desc:"제곱근까지만 나눠 보며 소수인지 판별해요.", learn:["메서드","소수 판별","Math.sqrt()"], code:
`public class PrimeNumbers {
    public static void main(String[] args) {
        for (int n = 2; n <= 50; n++) {
            if (isPrime(n)) System.out.print(n + " ");
        }
        System.out.println();
    }

    static boolean isPrime(int n) {
        if (n < 2) return false;
        for (int i = 2; i <= (int) Math.sqrt(n); i++) {    // 제곱근까지만 보면 충분하다
            if (n % i == 0) return false;
        }
        return true;
    }
}
` },
  { cat:"수학·숫자", title:"팩토리얼", name:"Factorial.java", level:1, pair:"factorial",
    desc:"1!~20! 을 구하며 long 의 한계를 확인해요.", learn:["long","누적 곱","오버플로"], code:
`public class Factorial {
    public static void main(String[] args) {
        long f = 1;
        for (int n = 1; n <= 20; n++) {
            f *= n;
            System.out.println(n + "! = " + f);
        }
        // 21! 부터는 long 으로도 담지 못해 값이 이상해진다(오버플로).
        System.out.println("long 이 담을 수 있는 최댓값: " + Long.MAX_VALUE);
    }
}
` },
  { cat:"수학·숫자", title:"최대공약수·최소공배수", name:"GcdLcm.java", level:2, pair:"gcd-lcm",
    desc:"유클리드 호제법으로 gcd 를 직접 만들어 lcm 까지 구해요.", learn:["유클리드 호제법","while","약수 관계"], code:
`public class GcdLcm {
    public static void main(String[] args) {
        int a = 24, b = 36;
        int g = gcd(a, b);
        System.out.println("최대공약수: " + g);
        System.out.println("최소공배수: " + (a / g * b));   // a * b 를 먼저 곱하면 넘칠 수 있다
    }

    // 파이썬의 math.gcd 같은 것이 자바에는 없다. 유클리드 호제법으로 직접 만든다.
    // 큰 수를 작은 수로 나눈 나머지로 바꿔 가며 나머지가 0이 될 때까지 반복한다.
    static int gcd(int a, int b) {
        while (b != 0) {
            int r = a % b;
            a = b;
            b = r;
        }
        return a;
    }
}
` },
  { cat:"수학·숫자", title:"약수 구하기", name:"Divisors.java", level:1, pair:"divisors",
    desc:"나머지가 0인 수만 모아 약수를 찾고 개수를 세요.", learn:["반복","나머지 연산","ArrayList"], code:
`import java.util.ArrayList;
import java.util.List;

public class Divisors {
    public static void main(String[] args) {
        int n = 36;
        List<Integer> divisors = new ArrayList<>();
        for (int i = 1; i <= n; i++) {
            if (n % i == 0) divisors.add(i);
        }
        System.out.println(n + "의 약수: " + divisors);
        System.out.println("개수: " + divisors.size());
    }
}
` },
  { cat:"수학·숫자", title:"진법 변환", name:"RadixConvert.java", level:1, pair:"radix",
    desc:"toBinaryString 과 parseInt(s, 2) 로 진법을 오가요.", learn:["진법","Integer.toBinaryString()","parseInt(s, base)"], code:
`public class RadixConvert {
    public static void main(String[] args) {
        int n = 255;
        System.out.println("2진수: " + Integer.toBinaryString(n));
        System.out.println("8진수: " + Integer.toOctalString(n));
        System.out.println("16진수: " + Integer.toHexString(n));

        // 거꾸로 — 글자로 적힌 다른 진법의 수를 10진수로
        System.out.println("11111111(2) = " + Integer.parseInt("11111111", 2));
        System.out.println("ff(16) = " + Integer.parseInt("ff", 16));
    }
}
` },
  { cat:"수학·숫자", title:"Math 클래스", name:"MathMethods.java", level:1,
    desc:"abs·pow·sqrt·round·max 를 한 번에 써 봐요.", learn:["Math 클래스","정적 메서드"], code:
`public class MathMethods {
    public static void main(String[] args) {
        System.out.println("절댓값: " + Math.abs(-7));
        System.out.println("2의 10제곱: " + Math.pow(2, 10));
        System.out.println("제곱근: " + Math.sqrt(144));
        System.out.println("반올림: " + Math.round(3.6));
        System.out.println("올림: " + Math.ceil(3.1));
        System.out.println("내림: " + Math.floor(3.9));
        System.out.println("더 큰 값: " + Math.max(10, 20));
        System.out.println("더 작은 값: " + Math.min(10, 20));
        System.out.printf("원주율: %.5f%n", Math.PI);
    }
}
` },
  { cat:"수학·숫자", title:"원주율 근사", name:"PiApprox.java", level:2, pair:"pi",
    desc:"라이프니츠 급수를 더해 원주율에 다가가요.", learn:["급수","반복 누적","double 오차"], code:
`public class PiApprox {
    public static void main(String[] args) {
        // 라이프니츠 공식: 1 - 1/3 + 1/5 - 1/7 + ... 을 4배 하면 원주율에 가까워진다
        double sum = 0;
        for (int k = 0; k < 100000; k++) {
            sum += (k % 2 == 0 ? 1.0 : -1.0) / (2 * k + 1);
        }
        System.out.println("근사값: " + (sum * 4));
        System.out.println("Math.PI: " + Math.PI);
    }
}
` },
  { cat:"수학·숫자", title:"완전수 찾기", name:"PerfectNumber.java", level:2, pair:"perfect",
    desc:"진약수의 합이 자기 자신인 수를 찾아요.", learn:["약수 합","이중 반복","조건 판별"], code:
`public class PerfectNumber {
    public static void main(String[] args) {
        for (int n = 2; n <= 10000; n++) {
            int sum = 0;
            for (int i = 1; i < n; i++) {          // 자기 자신을 뺀 약수를 모두 더한다
                if (n % i == 0) sum += i;
            }
            if (sum == n) System.out.println(n + " 은(는) 완전수예요.");
        }
    }
}
` },

  // ── 문자열 ──
  { cat:"문자열", title:"문자열 뒤집기", name:"ReverseString.java", level:1, pair:"reverse-string",
    desc:"StringBuilder 의 reverse 로 문자열을 뒤집어요.", learn:["StringBuilder","reverse()","charAt()"], code:
`public class ReverseString {
    public static void main(String[] args) {
        String s = "안녕하세요 자바";
        System.out.println(new StringBuilder(s).reverse().toString());

        // 직접 뒤에서부터 붙여도 같다
        StringBuilder sb = new StringBuilder();
        for (int i = s.length() - 1; i >= 0; i--) sb.append(s.charAt(i));
        System.out.println(sb.toString());
    }
}
` },
  { cat:"문자열", title:"회문 검사", name:"Palindrome.java", level:2, pair:"palindrome",
    desc:"양 끝에서 좁혀 오며 앞뒤가 같은지 확인해요.", learn:["charAt()","두 포인터"], code:
`public class Palindrome {
    public static void main(String[] args) {
        String[] words = { "level", "기러기", "java", "토마토" };
        for (String w : words) {
            System.out.println(w + " -> " + (isPalindrome(w) ? "회문이에요" : "회문이 아니에요"));
        }
    }

    static boolean isPalindrome(String s) {
        int left = 0, right = s.length() - 1;
        while (left < right) {
            if (s.charAt(left) != s.charAt(right)) return false;
            left++;
            right--;
        }
        return true;
    }
}
` },
  { cat:"문자열", title:"모음 개수 세기", name:"CountVowels.java", level:2, pair:"count-vowels",
    desc:"toCharArray 로 한 글자씩 보며 모음을 세요.", learn:["toCharArray()","indexOf()","카운트"], code:
`public class CountVowels {
    public static void main(String[] args) {
        String s = "Hello Java Programming";
        int count = 0;
        for (char c : s.toLowerCase().toCharArray()) {
            if ("aeiou".indexOf(c) >= 0) count++;
        }
        System.out.println(s);
        System.out.println("모음 개수: " + count);
    }
}
` },
  { cat:"문자열", title:"대소문자 변환", name:"ChangeCase.java", level:1, pair:"change-case",
    desc:"toUpperCase·toLowerCase·substring 으로 글자 모양을 바꿔요.", learn:["문자열 메서드","substring()"], code:
`public class ChangeCase {
    public static void main(String[] args) {
        String s = "Hello Java";
        System.out.println("대문자: " + s.toUpperCase());
        System.out.println("소문자: " + s.toLowerCase());

        // 첫 글자만 대문자로 — 앞 한 글자와 나머지를 나눠 붙인다
        String word = "java";
        System.out.println("첫 글자만: " + word.substring(0, 1).toUpperCase() + word.substring(1));
    }
}
` },
  { cat:"문자열", title:"문자열 메서드 모음", name:"StringMethods.java", level:1,
    desc:"length·charAt·indexOf·replace·trim·split 을 훑어요.", learn:["String API","split()"], code:
`public class StringMethods {
    public static void main(String[] args) {
        String raw = "  Hello, Java World!  ";
        System.out.println("원본: [" + raw + "]");
        System.out.println("앞뒤 공백 제거: [" + raw.trim() + "]");

        String s = raw.trim();
        System.out.println("길이: " + s.length());
        System.out.println("3번 글자: " + s.charAt(3));
        System.out.println("Java 의 위치: " + s.indexOf("Java"));
        System.out.println("바꾸기: " + s.replace("Java", "자바"));
        System.out.println("잘라내기: " + s.substring(7, 11));
        System.out.println("Hello 로 시작? " + s.startsWith("Hello"));
        System.out.println("World 를 포함? " + s.contains("World"));

        for (String piece : s.split(" ")) System.out.println("조각: " + piece);
    }
}
` },
  { cat:"문자열", title:"== 와 equals 의 차이", name:"StringEquals.java", level:2,
    desc:"같아 보이는 두 문자열이 == 에서 왜 다른지 확인해요.", learn:["equals()","참조 비교","문자열 상수 풀"], code:
`public class StringEquals {
    public static void main(String[] args) {
        String a = "java";
        String b = "java";
        String c = new String("java");

        System.out.println("a == b : " + (a == b));            // true — 같은 상수를 나눠 쓴다
        System.out.println("a == c : " + (a == c));            // false — new 로 만든 다른 객체다
        System.out.println("a.equals(c) : " + a.equals(c));    // true — 내용을 견준다

        String d = "ja";
        d = d + "va";
        System.out.println("이어 붙인 것 == : " + (a == d));
        System.out.println("이어 붙인 것 equals : " + a.equals(d));

        System.out.println("문자열 비교는 언제나 equals 로 하세요.");
    }
}
` },
  { cat:"문자열", title:"단어 빈도수", name:"WordCount.java", level:2, pair:"word-count",
    desc:"split 으로 자르고 HashMap 에 개수를 모아요.", learn:["split()","HashMap","getOrDefault()"], code:
`import java.util.HashMap;
import java.util.Map;

public class WordCount {
    public static void main(String[] args) {
        String text = "apple banana apple cherry banana apple";
        Map<String, Integer> count = new HashMap<>();

        for (String word : text.split(" ")) {
            count.put(word, count.getOrDefault(word, 0) + 1);   // 없으면 0에서 시작
        }
        for (Map.Entry<String, Integer> e : count.entrySet()) {
            System.out.println(e.getKey() + ": " + e.getValue());
        }
    }
}
` },
  { cat:"문자열", title:"문자와 코드값", name:"CharCode.java", level:1, pair:"char-code",
    desc:"char 와 int 를 오가며 아스키 코드를 확인해요.", learn:["char","형변환","아스키"], code:
`public class CharCode {
    public static void main(String[] args) {
        char c = 'A';
        int code = c;                      // char 는 그대로 숫자로도 읽힌다
        System.out.println(c + " 의 코드값: " + code);
        System.out.println("코드값 97 은: " + (char) 97);

        for (char ch = 'A'; ch <= 'E'; ch++) {
            System.out.println(ch + " = " + (int) ch);
        }
        System.out.println("'가' 의 코드값: " + (int) '가');
    }
}
` },
  { cat:"문자열", title:"시저 암호", name:"CaesarCipher.java", level:3, pair:"caesar",
    desc:"글자를 일정 칸 밀어 암호로 바꾸고 되돌려요.", learn:["char 연산","나머지 연산","암호화"], code:
`public class CaesarCipher {
    public static void main(String[] args) {
        String message = "Hello Java";
        int key = 3;

        String secret = shift(message, key);
        System.out.println("원문: " + message);
        System.out.println("암호: " + secret);
        System.out.println("복호: " + shift(secret, -key));
    }

    static String shift(String text, int n) {
        StringBuilder sb = new StringBuilder();
        for (char c : text.toCharArray()) {
            // ((x % 26) + 26) % 26 — 음수로 밀어도 0~25 안에 들어오게 한다
            if (c >= 'a' && c <= 'z') sb.append((char) ('a' + ((c - 'a' + n) % 26 + 26) % 26));
            else if (c >= 'A' && c <= 'Z') sb.append((char) ('A' + ((c - 'A' + n) % 26 + 26) % 26));
            else sb.append(c);
        }
        return sb.toString();
    }
}
` },

  // ── 배열 / 컬렉션 ──
  { cat:"배열·컬렉션", title:"배열 기초", name:"ArrayBasics.java", level:1,
    desc:"배열을 선언·초기화하고 length 와 for-each 로 훑어요.", learn:["배열","length","향상된 for"], code:
`import java.util.Arrays;

public class ArrayBasics {
    public static void main(String[] args) {
        int[] scores = { 90, 85, 77, 100, 68 };
        System.out.println("개수: " + scores.length);      // 배열은 length() 가 아니라 length
        System.out.println("전체: " + Arrays.toString(scores));

        System.out.println("--- 번호로 하나씩 ---");
        for (int i = 0; i < scores.length; i++) System.out.println(i + "번: " + scores[i]);

        System.out.println("--- 향상된 for ---");
        for (int s : scores) System.out.print(s + " ");
        System.out.println();

        int[] empty = new int[3];                          // 크기만 정하면 0으로 채워진다
        System.out.println("새 배열: " + Arrays.toString(empty));
    }
}
` },
  { cat:"배열·컬렉션", title:"최대·최소·평균", name:"ArrayStats.java", level:1, pair:"min-max",
    desc:"반복하며 직접 최댓값·최솟값·평균을 구해요.", learn:["반복 비교","평균","형변환"], code:
`public class ArrayStats {
    public static void main(String[] args) {
        int[] scores = { 88, 95, 70, 100, 63, 82 };

        int max = scores[0], min = scores[0], sum = 0;
        for (int s : scores) {
            if (s > max) max = s;
            if (s < min) min = s;
            sum += s;
        }
        System.out.println("최고점: " + max);
        System.out.println("최저점: " + min);
        System.out.println("합계: " + sum);
        System.out.printf("평균: %.2f%n", (double) sum / scores.length);   // 정수끼리 나누면 소수가 사라진다
    }
}
` },
  { cat:"배열·컬렉션", title:"2차원 배열", name:"Array2D.java", level:2, pair:"matrix",
    desc:"행과 열을 이중 for 로 돌며 대각선 합을 구해요.", learn:["2차원 배열","중첩 반복","인덱싱"], code:
`public class Array2D {
    public static void main(String[] args) {
        int[][] matrix = {
            { 1, 2, 3 },
            { 4, 5, 6 },
            { 7, 8, 9 }
        };

        for (int r = 0; r < matrix.length; r++) {
            for (int c = 0; c < matrix[r].length; c++) {
                System.out.printf("%3d", matrix[r][c]);
            }
            System.out.println();
        }

        int diagonal = 0;
        for (int i = 0; i < matrix.length; i++) diagonal += matrix[i][i];
        System.out.println("대각선 합: " + diagonal);
    }
}
` },
  { cat:"배열·컬렉션", title:"배열 복사와 참조", name:"ArrayCopy.java", level:2,
    desc:"= 로 넘긴 배열이 왜 같이 바뀌는지 보고 copyOf 로 고쳐요.", learn:["참조 복사","Arrays.copyOf()","Arrays.toString()"], code:
`import java.util.Arrays;

public class ArrayCopy {
    public static void main(String[] args) {
        int[] a = { 1, 2, 3 };
        int[] b = a;                  // 복사가 아니라 같은 배열을 함께 가리킬 뿐이다
        b[0] = 99;
        System.out.println("a: " + Arrays.toString(a));
        System.out.println("b: " + Arrays.toString(b));
        System.out.println("= 로 넘기면 한쪽만 바꿔도 같이 바뀝니다.");

        int[] c = Arrays.copyOf(a, a.length);   // 이렇게 해야 진짜 복사
        c[0] = 1;
        System.out.println("a: " + Arrays.toString(a));
        System.out.println("c: " + Arrays.toString(c));
    }
}
` },
  { cat:"배열·컬렉션", title:"ArrayList 기초", name:"ArrayListBasics.java", level:1,
    desc:"add·get·remove·size 로 크기가 변하는 목록을 다뤄요.", learn:["ArrayList","제네릭","향상된 for"], code:
`import java.util.ArrayList;
import java.util.List;

public class ArrayListBasics {
    public static void main(String[] args) {
        List<String> fruits = new ArrayList<>();     // 배열과 달리 크기를 미리 정하지 않는다
        fruits.add("사과");
        fruits.add("바나나");
        fruits.add("체리");
        System.out.println(fruits + " (개수 " + fruits.size() + ")");

        System.out.println("첫 번째: " + fruits.get(0));
        fruits.add(1, "딸기");                        // 가운데 끼워 넣기
        fruits.remove("체리");
        System.out.println(fruits);

        System.out.println("바나나가 있나요? " + fruits.contains("바나나"));
        for (String f : fruits) System.out.println("- " + f);
    }
}
` },
  { cat:"배열·컬렉션", title:"리스트 정렬", name:"ListSort.java", level:2, pair:"list-sort",
    desc:"Collections.sort 와 람다로 오름·내림차순 정렬해요.", learn:["Collections.sort()","reverseOrder()","람다"], code:
`import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class ListSort {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(List.of(5, 2, 9, 1, 7));
        Collections.sort(numbers);
        System.out.println("오름차순: " + numbers);

        Collections.sort(numbers, Collections.reverseOrder());
        System.out.println("내림차순: " + numbers);

        List<String> names = new ArrayList<>(List.of("홍길동", "김철수", "이영희"));
        Collections.sort(names);
        System.out.println("이름 정렬: " + names);

        names.sort((x, y) -> y.compareTo(x));     // 기준을 람다로 직접 줄 수도 있다
        System.out.println("거꾸로: " + names);
    }
}
` },
  { cat:"배열·컬렉션", title:"HashMap 전화번호부", name:"PhoneBook.java", level:2, pair:"dict-phone",
    desc:"이름-번호 쌍을 넣고 entrySet 으로 전부 훑어요.", learn:["HashMap","put()/get()","entrySet()"], code:
`import java.util.HashMap;
import java.util.Map;

public class PhoneBook {
    public static void main(String[] args) {
        Map<String, String> phone = new HashMap<>();
        phone.put("홍길동", "010-1111-1111");
        phone.put("김철수", "010-2222-2222");
        phone.put("이영희", "010-3333-3333");

        System.out.println("김철수: " + phone.get("김철수"));
        System.out.println("없는 사람: " + phone.getOrDefault("장보고", "등록 안 됨"));

        for (Map.Entry<String, String> e : phone.entrySet()) {
            System.out.println(e.getKey() + " : " + e.getValue());
        }
        phone.remove("홍길동");
        System.out.println("지운 뒤 인원: " + phone.size());
    }
}
` },
  { cat:"배열·컬렉션", title:"과목별 성적", name:"ScoreBoard.java", level:2, pair:"dict-scores",
    desc:"과목-점수를 Map 에 담고 평균을 내요.", learn:["LinkedHashMap","values()","평균"], code:
`import java.util.LinkedHashMap;
import java.util.Map;

public class ScoreBoard {
    public static void main(String[] args) {
        Map<String, Integer> scores = new LinkedHashMap<>();   // 넣은 순서를 지켜 준다
        scores.put("국어", 90);
        scores.put("수학", 85);
        scores.put("영어", 95);
        scores.put("과학", 88);

        int sum = 0;
        for (Map.Entry<String, Integer> e : scores.entrySet()) {
            System.out.println(e.getKey() + ": " + e.getValue());
            sum += e.getValue();
        }
        System.out.printf("평균: %.1f%n", (double) sum / scores.size());
    }
}
` },
  { cat:"배열·컬렉션", title:"중복 제거", name:"RemoveDuplicates.java", level:2, pair:"dedup",
    desc:"HashSet 으로 중복을 없애고 TreeSet 으로 정렬까지 해요.", learn:["HashSet","TreeSet","중복 제거"], code:
`import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

public class RemoveDuplicates {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(List.of(3, 1, 4, 1, 5, 9, 2, 6, 5, 3));
        System.out.println("원본: " + numbers);

        Set<Integer> unique = new HashSet<>(numbers);
        System.out.println("중복 제거: " + unique);

        Set<Integer> sorted = new TreeSet<>(numbers);      // 넣기만 해도 정렬까지 된다
        System.out.println("정렬까지: " + sorted);
    }
}
` },
  { cat:"배열·컬렉션", title:"스택과 큐", name:"StackQueue.java", level:2, pair:"stack-queue",
    desc:"ArrayDeque 하나로 스택과 큐를 모두 써 봐요.", learn:["Deque","ArrayDeque","스택/큐"], code:
`import java.util.ArrayDeque;
import java.util.Deque;

public class StackQueue {
    public static void main(String[] args) {
        Deque<String> stack = new ArrayDeque<>();     // 스택: 나중에 넣은 것이 먼저 나온다
        stack.push("첫째");
        stack.push("둘째");
        stack.push("셋째");
        System.out.println("스택에서 꺼내기: " + stack.pop() + ", " + stack.pop());

        Deque<String> queue = new ArrayDeque<>();     // 큐: 먼저 넣은 것이 먼저 나온다
        queue.offer("첫째");
        queue.offer("둘째");
        queue.offer("셋째");
        System.out.println("큐에서 꺼내기: " + queue.poll() + ", " + queue.poll());
    }
}
` },

  // ── 메서드 / 재귀 ──
  { cat:"메서드·재귀", title:"메서드 만들기", name:"MethodBasics.java", level:1, pair:"function-basics",
    desc:"매개변수와 반환값이 있는 메서드를 만들어 불러 써요.", learn:["메서드 정의","return","void"], code:
`public class MethodBasics {
    public static void main(String[] args) {
        greet("홍길동");
        System.out.println("3 + 5 = " + add(3, 5));
        System.out.println("더 큰 값: " + max(10, 7));
    }

    static void greet(String name) {        // 돌려줄 값이 없으면 void
        System.out.println("안녕하세요, " + name + "님!");
    }

    static int add(int a, int b) {          // int 를 돌려주는 메서드
        return a + b;
    }

    static int max(int a, int b) {
        return a > b ? a : b;
    }
}
` },
  { cat:"메서드·재귀", title:"메서드 오버로딩", name:"Overloading.java", level:2,
    desc:"이름은 같고 매개변수만 다른 메서드를 여러 개 만들어요.", learn:["오버로딩","시그니처"], code:
`public class Overloading {
    public static void main(String[] args) {
        System.out.println(add(1, 2));
        System.out.println(add(1, 2, 3));
        System.out.println(add(1.5, 2.5));
        System.out.println(add("자바", "재밌다"));
    }

    // 이름은 같아도 매개변수의 개수·타입이 다르면 서로 다른 메서드로 본다.
    static int add(int a, int b) { return a + b; }
    static int add(int a, int b, int c) { return a + b + c; }
    static double add(double a, double b) { return a + b; }
    static String add(String a, String b) { return a + " " + b; }
}
` },
  { cat:"메서드·재귀", title:"가변 인자", name:"VarArgs.java", level:2, pair:"varargs",
    desc:"int... 로 개수가 정해지지 않은 인자를 받아요.", learn:["가변 인자","배열로 전달"], code:
`public class VarArgs {
    public static void main(String[] args) {
        System.out.println(sum());
        System.out.println(sum(1, 2));
        System.out.println(sum(1, 2, 3, 4, 5));
        report("홍길동", 90, 85, 100);
    }

    static int sum(int... numbers) {     // 메서드 안에서는 배열처럼 쓴다
        int total = 0;
        for (int n : numbers) total += n;
        return total;
    }

    static void report(String name, int... scores) {
        System.out.println(name + " 의 점수 " + scores.length + "개, 합계 " + sum(scores));
    }
}
` },
  { cat:"메서드·재귀", title:"재귀 팩토리얼", name:"RecursiveFactorial.java", level:2, pair:"rec-factorial",
    desc:"자기 자신을 부르는 메서드로 팩토리얼을 구해요.", learn:["재귀","종료 조건"], code:
`public class RecursiveFactorial {
    public static void main(String[] args) {
        for (int n = 1; n <= 10; n++) {
            System.out.println(n + "! = " + factorial(n));
        }
    }

    static long factorial(int n) {
        if (n <= 1) return 1;              // 종료 조건이 없으면 끝없이 자기를 부른다
        return n * factorial(n - 1);
    }
}
` },
  { cat:"메서드·재귀", title:"재귀 피보나치", name:"RecursiveFibonacci.java", level:2, pair:"rec-fibonacci",
    desc:"재귀로 피보나치를 구하고 몇 번이나 불렀는지 세어 봐요.", learn:["재귀","중복 호출"], code:
`public class RecursiveFibonacci {
    static int calls = 0;

    public static void main(String[] args) {
        for (int n = 1; n <= 10; n++) System.out.print(fib(n) + " ");
        System.out.println();

        calls = 0;
        System.out.println("fib(20) = " + fib(20));
        System.out.println("그러려고 부른 횟수: " + calls + "번");
        System.out.println("같은 값을 몇 번씩 다시 구하는 것이 재귀의 약점이에요.");
    }

    static int fib(int n) {
        calls++;
        if (n <= 2) return 1;
        return fib(n - 1) + fib(n - 2);
    }
}
` },
  { cat:"메서드·재귀", title:"하노이 탑", name:"TowerOfHanoi.java", level:3, pair:"hanoi",
    desc:"재귀로 원반 옮기는 순서를 단계별로 출력해요.", learn:["재귀","분할 정복"], code:
`public class TowerOfHanoi {
    static int step = 0;

    public static void main(String[] args) {
        hanoi(3, "A", "C", "B");
        System.out.println("모두 " + step + "번 옮겼어요.");
    }

    // n개를 from 에서 to 로 옮긴다. via 는 거쳐 가는 기둥.
    static void hanoi(int n, String from, String to, String via) {
        if (n == 1) {
            System.out.println(++step + ". 원반 1: " + from + " -> " + to);
            return;
        }
        hanoi(n - 1, from, via, to);       // 위의 n-1개를 잠깐 옆으로
        System.out.println(++step + ". 원반 " + n + ": " + from + " -> " + to);
        hanoi(n - 1, via, to, from);       // 다시 목적지로
    }
}
` },

  // ── 클래스 / 객체 ──
  { cat:"클래스·객체", title:"클래스와 객체", name:"Student.java", level:2, pair:"class-basics",
    desc:"필드와 생성자를 갖춘 클래스를 만들고 new 로 객체를 찍어요.", learn:["class","생성자","new","필드"], code:
`public class Student {
    String name;
    int korean;
    int math;

    Student(String name, int korean, int math) {
        this.name = name;          // this.name 은 필드, name 은 매개변수
        this.korean = korean;
        this.math = math;
    }

    int total() { return korean + math; }
    double average() { return total() / 2.0; }

    public static void main(String[] args) {
        Student[] students = {
            new Student("홍길동", 90, 85),
            new Student("김철수", 75, 100)
        };
        for (Student s : students) {
            System.out.printf("%s: 총점 %d, 평균 %.1f%n", s.name, s.total(), s.average());
        }
    }
}
` },
  { cat:"클래스·객체", title:"은행 계좌 (캡슐화)", name:"BankAccount.java", level:2, pair:"bank-account",
    desc:"private 필드를 getter·setter 로만 여닫아요.", learn:["private","캡슐화","getter/setter"], code:
`public class BankAccount {
    private String owner;
    private int balance;              // private 이라 바깥에서 직접 못 건드린다

    BankAccount(String owner, int balance) {
        this.owner = owner;
        this.balance = balance;
    }

    public String getOwner() { return owner; }
    public int getBalance() { return balance; }

    public void deposit(int amount) {
        if (amount <= 0) { System.out.println("입금액은 0보다 커야 해요."); return; }
        balance += amount;
    }

    public void withdraw(int amount) {
        if (amount > balance) { System.out.println("잔액이 모자라요."); return; }
        balance -= amount;
    }

    public static void main(String[] args) {
        BankAccount account = new BankAccount("홍길동", 10000);
        account.deposit(5000);
        account.withdraw(3000);
        account.withdraw(100000);
        // account.balance = 999999;   // private 이라 이렇게 몰래 바꿀 수 없다
        System.out.println(account.getOwner() + " 님 잔액: " + account.getBalance() + "원");
    }
}
` },
  { cat:"클래스·객체", title:"toString 재정의", name:"PointToString.java", level:2, pair:"point",
    desc:"@Override 로 toString 을 고쳐 객체를 보기 좋게 출력해요.", learn:["@Override","toString()","거리 공식"], code:
`public class PointToString {
    public static void main(String[] args) {
        Point a = new Point(0, 0);
        Point b = new Point(3, 4);

        System.out.println("a = " + a);        // toString 을 고쳤기에 보기 좋게 나온다
        System.out.println("b = " + b);
        System.out.printf("두 점 사이 거리: %.2f%n", a.distanceTo(b));
    }
}

class Point {
    int x;
    int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    double distanceTo(Point other) {
        int dx = x - other.x;
        int dy = y - other.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    @Override
    public String toString() {
        return "(" + x + ", " + y + ")";
    }
}
` },
  { cat:"클래스·객체", title:"생성자 오버로딩과 this", name:"Rectangle.java", level:2,
    desc:"생성자를 여러 개 두고 this(...) 로 서로 부르게 해요.", learn:["생성자 오버로딩","this()"], code:
`public class Rectangle {
    int width;
    int height;

    Rectangle() { this(1, 1); }                  // 다른 생성자를 부른다
    Rectangle(int side) { this(side, side); }    // 정사각형
    Rectangle(int width, int height) {
        this.width = width;
        this.height = height;
    }

    int area() { return width * height; }

    public static void main(String[] args) {
        Rectangle[] shapes = { new Rectangle(), new Rectangle(5), new Rectangle(3, 4) };
        for (Rectangle r : shapes) {
            System.out.println(r.width + " x " + r.height + " = " + r.area());
        }
    }
}
` },
  { cat:"클래스·객체", title:"상속", name:"AnimalInherit.java", level:3, pair:"inherit",
    desc:"부모 클래스를 물려받아 메서드를 재정의해요.", learn:["extends","super","오버라이딩"], code:
`public class AnimalInherit {
    public static void main(String[] args) {
        Animal[] animals = { new Animal("동물"), new Dog("바둑이"), new Cat("나비") };
        for (Animal a : animals) {
            a.introduce();
            a.speak();          // 같은 이름을 불러도 실제 종류에 맞게 동작한다
        }
    }
}

class Animal {
    protected String name;

    Animal(String name) { this.name = name; }

    void introduce() { System.out.println("저는 " + name + " 입니다."); }
    void speak() { System.out.println("..."); }
}

class Dog extends Animal {
    Dog(String name) { super(name); }        // 부모의 생성자를 먼저 부른다

    @Override
    void speak() { System.out.println("멍멍!"); }
}

class Cat extends Animal {
    Cat(String name) { super(name); }

    @Override
    void speak() { System.out.println("야옹~"); }
}
` },
  { cat:"클래스·객체", title:"인터페이스와 다형성", name:"ShapeInterface.java", level:3,
    desc:"같은 인터페이스를 구현한 도형들을 한 배열에 담아 돌려요.", learn:["interface","implements","다형성"], code:
`public class ShapeInterface {
    public static void main(String[] args) {
        Shape[] shapes = { new Circle(3), new Square(4) };   // 서로 다른 클래스를 한 배열에

        double total = 0;
        for (Shape s : shapes) {
            System.out.printf("%s 의 넓이: %.2f%n", s.name(), s.area());
            total += s.area();
        }
        System.out.printf("넓이 합계: %.2f%n", total);
    }
}

interface Shape {
    double area();      // 몸통 없이 "이런 메서드가 있다"는 약속만 한다
    String name();
}

class Circle implements Shape {
    private double radius;

    Circle(double radius) { this.radius = radius; }

    public double area() { return Math.PI * radius * radius; }
    public String name() { return "원"; }
}

class Square implements Shape {
    private double side;

    Square(double side) { this.side = side; }

    public double area() { return side * side; }
    public String name() { return "정사각형"; }
}
` },
  { cat:"클래스·객체", title:"추상 클래스", name:"AbstractVehicle.java", level:3,
    desc:"abstract 메서드를 남겨 두고 자식이 채우게 해요.", learn:["abstract","상속","템플릿"], code:
`public class AbstractVehicle {
    public static void main(String[] args) {
        Vehicle[] vehicles = { new Car("소나타", 4), new Bike("자전거") };
        for (Vehicle v : vehicles) {
            v.describe();      // 부모가 정해 둔 부분
            v.move();          // 자식이 채운 부분
        }
    }
}

abstract class Vehicle {
    protected String name;

    Vehicle(String name) { this.name = name; }

    void describe() { System.out.println("[" + name + "]"); }

    abstract void move();      // 몸통이 없다 — 자식이 반드시 채워야 한다
}

class Car extends Vehicle {
    private int wheels;

    Car(String name, int wheels) {
        super(name);
        this.wheels = wheels;
    }

    @Override
    void move() { System.out.println("바퀴 " + wheels + "개로 도로를 달려요."); }
}

class Bike extends Vehicle {
    Bike(String name) { super(name); }

    @Override
    void move() { System.out.println("페달을 밟아 나아가요."); }
}
` },
  { cat:"클래스·객체", title:"static 필드와 메서드", name:"CounterStatic.java", level:2,
    desc:"객체를 만들 때마다 늘어나는 static 카운터를 봐요.", learn:["static","클래스 변수 vs 인스턴스 변수"], code:
`public class CounterStatic {
    public static void main(String[] args) {
        System.out.println("만들기 전 인원: " + Visitor.count);

        Visitor a = new Visitor("홍길동");
        Visitor b = new Visitor("김철수");
        Visitor c = new Visitor("이영희");

        a.hello();
        b.hello();
        c.hello();
        System.out.println("지금까지 온 사람: " + Visitor.count + "명");
        System.out.println("count 는 객체마다가 아니라 클래스에 하나뿐이에요.");
    }
}

class Visitor {
    static int count = 0;     // 모든 객체가 함께 쓰는 값
    String name;              // 객체마다 따로 갖는 값

    Visitor(String name) {
        this.name = name;
        count++;
    }

    void hello() { System.out.println(name + " 님 안녕하세요. (지금까지 " + count + "명)"); }
}
` },

  // ── 예외 / 입력검증 ──
  { cat:"예외·입력검증", title:"try-catch 기초", name:"TryCatch.java", level:2, pair:"try-except",
    desc:"숫자가 아닌 입력을 NumberFormatException 으로 잡아요.", learn:["try-catch","NumberFormatException"], code:
`public class TryCatch {
    public static void main(String[] args) {
        String[] inputs = { "123", "열둘", "45" };

        for (String s : inputs) {
            try {
                int n = Integer.parseInt(s);
                System.out.println(s + " -> " + n);
            } catch (NumberFormatException e) {
                System.out.println(s + " 는 숫자가 아니에요.");
            }
        }
        System.out.println("예외를 잡았기 때문에 프로그램이 끝까지 왔어요.");
    }
}
` },
  { cat:"예외·입력검증", title:"0으로 나누기", name:"DivideByZero.java", level:1, pair:"div-zero",
    desc:"ArithmeticException 을 잡고 실수 나눗셈과 비교해요.", learn:["ArithmeticException","Infinity/NaN"], code:
`public class DivideByZero {
    public static void main(String[] args) {
        int a = 10, b = 0;
        try {
            System.out.println(a / b);
        } catch (ArithmeticException e) {
            System.out.println("0으로 나눌 수 없어요: " + e.getMessage());
        }

        // 실수 나눗셈은 예외 대신 특별한 값이 나온다
        System.out.println("10.0 / 0 = " + (10.0 / 0));
        System.out.println("0.0 / 0 = " + (0.0 / 0));
    }
}
` },
  { cat:"예외·입력검증", title:"배열 범위 넘기", name:"ArrayBounds.java", level:2,
    desc:"ArrayIndexOutOfBoundsException 이 언제 나는지 확인해요.", learn:["인덱스 범위","예외"], code:
`public class ArrayBounds {
    public static void main(String[] args) {
        int[] scores = { 90, 85, 77 };
        System.out.println("번호는 0부터 " + (scores.length - 1) + " 까지예요.");

        try {
            System.out.println(scores[3]);
        } catch (ArrayIndexOutOfBoundsException e) {
            System.out.println("3번은 없어요. 배열 크기: " + scores.length);
        }

        for (int i = 0; i < scores.length; i++) {   // <= 로 적으면 바로 이 예외가 난다
            System.out.println(i + "번: " + scores[i]);
        }
    }
}
` },
  { cat:"예외·입력검증", title:"여러 예외와 finally", name:"MultiCatch.java", level:2, pair:"multi-except",
    desc:"예외 종류별로 다르게 처리하고 finally 를 꼭 지나가게 해요.", learn:["다중 catch","finally"], code:
`public class MultiCatch {
    public static void main(String[] args) {
        test("0");
        test("열");
        test("5");
    }

    static void test(String input) {
        try {
            int n = Integer.parseInt(input);
            System.out.println("100 / " + n + " = " + (100 / n));
        } catch (NumberFormatException e) {
            System.out.println(input + ": 숫자가 아니에요.");
        } catch (ArithmeticException e) {
            System.out.println(input + ": 0으로는 나눌 수 없어요.");
        } finally {
            System.out.println("-> 성공하든 실패하든 여기는 지나갑니다.");
        }
    }
}
` },
  { cat:"예외·입력검증", title:"입력 검증 반복", name:"InputValidate.java", level:2, pair:"validate",
    desc:"제대로 된 숫자를 넣을 때까지 다시 물어봐요.", learn:["while","Scanner","예외 처리"], code:
`import java.util.Scanner;

public class InputValidate {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int age = -1;

        while (age < 0) {
            System.out.print("나이를 숫자로 넣어 주세요: ");
            String line = sc.nextLine().trim();
            try {
                age = Integer.parseInt(line);
                if (age < 0) System.out.println("0보다 작을 수는 없어요.");
            } catch (NumberFormatException e) {
                System.out.println(line + " 는 숫자가 아니에요. 다시!");
            }
        }
        System.out.println("입력한 나이: " + age + "살");
    }
}
` },

  // ── 정렬 / 탐색 ──
  { cat:"정렬·탐색", title:"버블 정렬", name:"BubbleSort.java", level:2, pair:"bubble",
    desc:"이웃끼리 비교·교환을 반복해 정렬해요.", learn:["버블 정렬","이중 반복","교환"], code:
`import java.util.Arrays;

public class BubbleSort {
    public static void main(String[] args) {
        int[] data = { 5, 2, 9, 1, 7, 3 };
        System.out.println("정렬 전: " + Arrays.toString(data));

        for (int i = 0; i < data.length - 1; i++) {
            for (int j = 0; j < data.length - 1 - i; j++) {   // 뒤쪽은 이미 자리를 잡았다
                if (data[j] > data[j + 1]) {
                    int temp = data[j];
                    data[j] = data[j + 1];
                    data[j + 1] = temp;
                }
            }
            System.out.println((i + 1) + "번째 통과: " + Arrays.toString(data));
        }
    }
}
` },
  { cat:"정렬·탐색", title:"선택 정렬", name:"SelectionSort.java", level:2, pair:"selection",
    desc:"남은 것 중 가장 작은 값을 앞으로 골라 와요.", learn:["선택 정렬","최솟값 인덱스"], code:
`import java.util.Arrays;

public class SelectionSort {
    public static void main(String[] args) {
        int[] data = { 5, 2, 9, 1, 7, 3 };
        System.out.println("정렬 전: " + Arrays.toString(data));

        for (int i = 0; i < data.length - 1; i++) {
            int min = i;
            for (int j = i + 1; j < data.length; j++) {
                if (data[j] < data[min]) min = j;       // 가장 작은 값의 자리를 기억해 두고
            }
            int temp = data[i];                         // 한 번만 바꾼다
            data[i] = data[min];
            data[min] = temp;
            System.out.println((i + 1) + "번째: " + Arrays.toString(data));
        }
    }
}
` },
  { cat:"정렬·탐색", title:"삽입 정렬", name:"InsertionSort.java", level:2,
    desc:"앞쪽 정렬된 부분에 알맞은 자리를 찾아 끼워요.", learn:["삽입 정렬","뒤로 밀기"], code:
`import java.util.Arrays;

public class InsertionSort {
    public static void main(String[] args) {
        int[] data = { 5, 2, 9, 1, 7, 3 };
        System.out.println("정렬 전: " + Arrays.toString(data));

        for (int i = 1; i < data.length; i++) {
            int key = data[i];
            int j = i - 1;
            while (j >= 0 && data[j] > key) {      // 자리를 찾을 때까지 한 칸씩 뒤로 민다
                data[j + 1] = data[j];
                j--;
            }
            data[j + 1] = key;
            System.out.println(i + "번째: " + Arrays.toString(data));
        }
    }
}
` },
  { cat:"정렬·탐색", title:"이진 탐색", name:"BinarySearch.java", level:2, pair:"binary-search",
    desc:"정렬된 배열을 절반씩 좁혀 값을 찾아요.", learn:["이진 탐색","while","중간 인덱스"], code:
`import java.util.Arrays;

public class BinarySearch {
    public static void main(String[] args) {
        int[] data = { 1, 3, 5, 7, 9, 11, 13, 15 };     // 반드시 정렬돼 있어야 한다
        System.out.println("자료: " + Arrays.toString(data));
        System.out.println("11 은 " + search(data, 11) + "번");
        System.out.println("4 는 " + search(data, 4) + "번 (없으면 -1)");
    }

    static int search(int[] data, int target) {
        int low = 0, high = data.length - 1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (data[mid] == target) return mid;
            if (data[mid] < target) low = mid + 1;      // 뒤쪽 절반만 남긴다
            else high = mid - 1;                        // 앞쪽 절반만 남긴다
        }
        return -1;
    }
}
` },
  { cat:"정렬·탐색", title:"선형 탐색", name:"LinearSearch.java", level:1,
    desc:"처음부터 하나씩 비교해 찾고 없으면 -1 을 돌려줘요.", learn:["선형 탐색","equals()","반환값 -1"], code:
`public class LinearSearch {
    public static void main(String[] args) {
        String[] names = { "홍길동", "김철수", "이영희", "박민수" };
        System.out.println("이영희: " + find(names, "이영희") + "번");
        System.out.println("장보고: " + find(names, "장보고") + "번");
    }

    static int find(String[] names, String target) {
        for (int i = 0; i < names.length; i++) {
            if (names[i].equals(target)) return i;    // 문자열 비교는 == 이 아니라 equals
        }
        return -1;                                    // 못 찾았다는 표시
    }
}
` },
  { cat:"정렬·탐색", title:"여러 기준으로 정렬", name:"SortWithComparator.java", level:3, pair:"multi-sort",
    desc:"Comparator 로 나이·이름 순서를 바꿔 가며 정렬해요.", learn:["Comparator","comparing()","thenComparing()"], code:
`import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class SortWithComparator {
    public static void main(String[] args) {
        List<Person> people = new ArrayList<>();
        people.add(new Person("홍길동", 17));
        people.add(new Person("김철수", 15));
        people.add(new Person("이영희", 17));
        people.add(new Person("박민수", 16));

        people.sort(Comparator.comparingInt((Person p) -> p.age));
        System.out.println("나이 순: " + people);

        people.sort(Comparator.comparing((Person p) -> p.name));
        System.out.println("이름 순: " + people);

        // 나이는 내림차순으로, 나이가 같으면 이름 순으로
        people.sort(Comparator.comparingInt((Person p) -> p.age).reversed()
            .thenComparing(Comparator.comparing((Person p) -> p.name)));
        System.out.println("나이 내림차순 + 이름 순: " + people);
    }
}

class Person {
    String name;
    int age;

    Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    @Override
    public String toString() { return name + "(" + age + ")"; }
}
` },

  // ── 시뮬레이션 / 확률 ──
  { cat:"시뮬레이션·확률", title:"주사위 굴리기", name:"DiceRoll.java", level:1, pair:"dice",
    desc:"Random 으로 주사위를 굴려 눈이 나온 횟수를 세요.", learn:["Random","nextInt()","배열 카운트"], code:
`import java.util.Random;

public class DiceRoll {
    public static void main(String[] args) {
        Random random = new Random();
        int[] count = new int[7];        // 0번 자리는 쓰지 않고 1~6만 쓴다

        for (int i = 0; i < 60; i++) {
            int eye = random.nextInt(6) + 1;    // 0~5 가 나오므로 1을 더한다
            count[eye]++;
        }
        for (int eye = 1; eye <= 6; eye++) {
            System.out.print(eye + ": ");
            for (int i = 0; i < count[eye]; i++) System.out.print("*");
            System.out.println(" (" + count[eye] + "번)");
        }
    }
}
` },
  { cat:"시뮬레이션·확률", title:"로또 번호 뽑기", name:"LottoNumbers.java", level:2, pair:"lotto",
    desc:"겹치지 않게 6개를 뽑아 정렬해서 보여 줘요.", learn:["Collections.shuffle()","subList()","정렬"], code:
`import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class LottoNumbers {
    public static void main(String[] args) {
        List<Integer> balls = new ArrayList<>();
        for (int i = 1; i <= 45; i++) balls.add(i);

        Collections.shuffle(balls);                                    // 통을 흔들어 섞고
        List<Integer> picked = new ArrayList<>(balls.subList(0, 6));   // 앞에서 6개만
        Collections.sort(picked);

        System.out.println("이번 주 번호: " + picked);
    }
}
` },
  { cat:"시뮬레이션·확률", title:"가위바위보", name:"RockPaperScissors.java", level:2, pair:"rps",
    desc:"입력받은 손과 컴퓨터의 손을 겨뤄 승패를 가려요.", learn:["Scanner","Random","조건 분기"], code:
`import java.util.Random;
import java.util.Scanner;

public class RockPaperScissors {
    public static void main(String[] args) {
        String[] hands = { "가위", "바위", "보" };
        Scanner sc = new Scanner(System.in);
        Random random = new Random();

        System.out.print("가위/바위/보 중 하나를 내세요: ");
        String mine = sc.nextLine().trim();
        String yours = hands[random.nextInt(3)];
        System.out.println("컴퓨터: " + yours);

        int me = indexOf(hands, mine);
        int you = indexOf(hands, yours);

        if (me < 0) System.out.println("가위, 바위, 보 중에서 내야 해요.");
        else if (me == you) System.out.println("비겼어요!");
        else if ((me + 1) % 3 == you) System.out.println("졌어요...");
        else System.out.println("이겼어요!");
    }

    static int indexOf(String[] hands, String hand) {
        for (int i = 0; i < hands.length; i++) {
            if (hands[i].equals(hand)) return i;
        }
        return -1;
    }
}
` },
  { cat:"시뮬레이션·확률", title:"숫자 맞히기", name:"NumberGuess.java", level:2, pair:"guess",
    desc:"반복해서 입력받으며 up/down 을 알려줘요.", learn:["while","break","비교"], code:
`import java.util.Random;
import java.util.Scanner;

public class NumberGuess {
    public static void main(String[] args) {
        int answer = new Random().nextInt(100) + 1;
        Scanner sc = new Scanner(System.in);
        int tries = 0;

        System.out.println("1부터 100 사이의 수를 맞혀 보세요.");
        while (true) {
            System.out.print("숫자: ");
            int guess = Integer.parseInt(sc.nextLine().trim());
            tries++;

            if (guess == answer) {
                System.out.println("정답! " + tries + "번 만에 맞혔어요.");
                break;
            }
            System.out.println(guess < answer ? "UP! 더 큰 수" : "DOWN! 더 작은 수");
        }
    }
}
` },
  { cat:"시뮬레이션·확률", title:"동전 던지기 통계", name:"CoinFlip.java", level:2, pair:"coin",
    desc:"1000번 던져 앞·뒤 비율이 얼마나 5:5에 가까운지 봐요.", learn:["Random","비율","시뮬레이션"], code:
`import java.util.Random;

public class CoinFlip {
    public static void main(String[] args) {
        Random random = new Random();
        int head = 0, tail = 0;

        for (int i = 0; i < 1000; i++) {
            if (random.nextBoolean()) head++;
            else tail++;
        }
        System.out.println("앞면: " + head + "번");
        System.out.println("뒷면: " + tail + "번");
        System.out.printf("앞면 비율: %.1f%%%n", head / 10.0);
        System.out.println("많이 던질수록 5:5 에 가까워져요.");
    }
}
` },

  // ── 날짜 / 시간 ──
  { cat:"날짜·시간", title:"오늘 날짜·시간", name:"TodayDate.java", level:1, pair:"today",
    desc:"LocalDateTime.now 를 원하는 서식으로 꾸며 출력해요.", learn:["LocalDate","LocalDateTime","DateTimeFormatter"], code:
`import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class TodayDate {
    public static void main(String[] args) {
        LocalDate today = LocalDate.now();
        LocalDateTime now = LocalDateTime.now();

        System.out.println("오늘: " + today);
        System.out.println("지금: " + now);

        DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyy년 M월 d일 HH시 mm분");
        System.out.println("꾸며서: " + now.format(f));
        System.out.println("올해는 " + today.getYear() + "년 " + today.getMonthValue() + "월이에요.");
    }
}
` },
  { cat:"날짜·시간", title:"요일 구하기", name:"WeekdayFinder.java", level:1, pair:"weekday",
    desc:"날짜의 요일을 구해 한글 이름으로 보여 줘요.", learn:["getDayOfWeek()","getDisplayName()","Locale"], code:
`import java.time.LocalDate;
import java.time.format.TextStyle;
import java.util.Locale;

public class WeekdayFinder {
    public static void main(String[] args) {
        LocalDate today = LocalDate.now();
        System.out.println("오늘은 " + korean(today) + "이에요.");

        LocalDate day = LocalDate.of(2026, 1, 1);
        for (int i = 0; i < 7; i++) {
            System.out.println(day + " : " + korean(day));
            day = day.plusDays(1);
        }
    }

    // java.time.DayOfWeek 와 이름이 겹치지 않게 클래스 이름을 WeekdayFinder 로 지었다.
    static String korean(LocalDate date) {
        return date.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.KOREAN);
    }
}
` },
  { cat:"날짜·시간", title:"D-day 계산", name:"DDayCounter.java", level:2, pair:"dday",
    desc:"두 날짜 사이의 일수를 세어 남은 날을 구해요.", learn:["ChronoUnit.DAYS.between()","plusYears()"], code:
`import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

public class DDayCounter {
    public static void main(String[] args) {
        LocalDate today = LocalDate.now();
        LocalDate target = LocalDate.of(today.getYear(), 12, 25);
        if (target.isBefore(today)) target = target.plusYears(1);    // 이미 지났으면 내년 것으로

        long days = ChronoUnit.DAYS.between(today, target);
        System.out.println("오늘: " + today);
        System.out.println("목표: " + target);
        System.out.println("D-" + days);
        System.out.println("주로 따지면 약 " + (days / 7) + "주 남았어요.");
    }
}
` },
  { cat:"날짜·시간", title:"만 나이 계산", name:"AgeCalculator.java", level:2, pair:"age",
    desc:"생일이 지났는지까지 따져 만 나이를 구해요.", learn:["Period.between()","getYears()"], code:
`import java.time.LocalDate;
import java.time.Period;
import java.time.temporal.ChronoUnit;

public class AgeCalculator {
    public static void main(String[] args) {
        LocalDate birth = LocalDate.of(2008, 5, 20);
        LocalDate today = LocalDate.now();

        Period period = Period.between(birth, today);   // 생일이 지났는지까지 알아서 따져 준다
        System.out.println("생일: " + birth);
        System.out.println("만 나이: " + period.getYears() + "살");
        System.out.println("정확히는 " + period.getYears() + "년 "
            + period.getMonths() + "개월 " + period.getDays() + "일");
        System.out.println("태어난 지 " + ChronoUnit.DAYS.between(birth, today) + "일 됐어요.");
    }
}
` },
  { cat:"날짜·시간", title:"이번 달 달력", name:"MonthCalendar.java", level:3, pair:"calendar",
    desc:"1일의 요일과 마지막 날을 구해 달력을 직접 그려요.", learn:["YearMonth","lengthOfMonth()","printf"], code:
`import java.time.LocalDate;
import java.time.YearMonth;

public class MonthCalendar {
    public static void main(String[] args) {
        YearMonth month = YearMonth.now();
        LocalDate first = month.atDay(1);
        int lastDay = month.lengthOfMonth();
        int blank = first.getDayOfWeek().getValue() % 7;   // 월=1 ... 일=7 이므로 일요일을 0으로

        // 파이썬은 calendar.month(y, m) 한 줄이지만, 자바에서는 직접 그린다.
        System.out.println("      " + month.getYear() + "년 " + month.getMonthValue() + "월");
        System.out.println(" 일  월  화  수  목  금  토");

        for (int i = 0; i < blank; i++) System.out.print("    ");
        for (int day = 1; day <= lastDay; day++) {
            System.out.printf("%3d ", day);
            if ((blank + day) % 7 == 0) System.out.println();
        }
        System.out.println();
    }
}
` },

  // ── 응용 / 도전 ──
  { cat:"응용·도전", title:"에라토스테네스의 체", name:"SieveOfEratosthenes.java", level:3, pair:"sieve",
    desc:"boolean 배열로 배수를 지워 소수를 빠르게 찾아요.", learn:["에라토스테네스의 체","boolean 배열"], code:
`public class SieveOfEratosthenes {
    public static void main(String[] args) {
        int n = 100;
        boolean[] composite = new boolean[n + 1];      // true = 소수가 아님(지워진 수)

        for (int i = 2; i * i <= n; i++) {
            if (composite[i]) continue;                // 이미 지워졌으면 건너뛴다
            for (int j = i * i; j <= n; j += i) composite[j] = true;
        }

        int count = 0;
        for (int i = 2; i <= n; i++) {
            if (!composite[i]) {
                System.out.print(i + " ");
                count++;
            }
        }
        System.out.println();
        System.out.println("2부터 " + n + " 까지 소수는 " + count + "개예요.");
    }
}
` },
  { cat:"응용·도전", title:"성적 처리 프로그램", name:"GradeReport.java", level:4,
    desc:"학생 클래스와 배열, printf 서식으로 성적표를 만들어요.", learn:["클래스+배열","printf 표","등급 판정"], code:
`public class GradeReport {
    public static void main(String[] args) {
        Learner[] students = {
            new Learner("홍길동", 90, 85, 100),
            new Learner("김철수", 75, 60, 88),
            new Learner("이영희", 100, 95, 92),
            new Learner("박민수", 55, 70, 64)
        };

        System.out.printf("%-8s %4s %4s %4s %6s %7s %4s%n", "이름", "국어", "수학", "영어", "총점", "평균", "등급");
        System.out.println("------------------------------------------------");

        int total = 0;
        for (Learner s : students) {
            System.out.printf("%-8s %4d %4d %4d %6d %7.1f %4s%n",
                s.name, s.korean, s.math, s.english, s.total(), s.average(), s.grade());
            total += s.total();
        }
        System.out.println("------------------------------------------------");
        System.out.printf("반 전체 평균: %.1f%n", total / (double) (students.length * 3));
    }

    // 보조 클래스는 파일 안에 static 중첩 클래스로 둔다(다른 예제의 클래스와 이름이 겹치지 않게).
    static class Learner {
        String name;
        int korean;
        int math;
        int english;

        Learner(String name, int korean, int math, int english) {
            this.name = name;
            this.korean = korean;
            this.math = math;
            this.english = english;
        }

        int total() { return korean + math + english; }
        double average() { return total() / 3.0; }

        String grade() {
            double avg = average();
            if (avg >= 90) return "A";
            if (avg >= 80) return "B";
            if (avg >= 70) return "C";
            return "D";
        }
    }
}
` },
  { cat:"응용·도전", title:"도서 관리 (메뉴형)", name:"LibraryApp.java", level:4,
    desc:"while 메뉴와 switch 로 도서를 넣고 빌리고 반납해요.", learn:["메뉴 반복","switch","ArrayList","클래스"], code:
`import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;

public class LibraryApp {
    public static void main(String[] args) {
        List<Book> books = new ArrayList<>();
        books.add(new Book("어린 왕자", "생텍쥐페리"));
        books.add(new Book("데미안", "헤세"));
        Scanner sc = new Scanner(System.in);

        while (true) {
            System.out.println();
            System.out.println("1) 목록  2) 추가  3) 대출  4) 반납  0) 끝내기");
            System.out.print("고르세요: ");
            String menu = sc.nextLine().trim();

            if (menu.equals("0")) {
                System.out.println("안녕히 가세요.");
                break;
            }
            switch (menu) {
                case "1":
                    for (int i = 0; i < books.size(); i++) System.out.println(i + ". " + books.get(i));
                    break;
                case "2":
                    System.out.print("제목: ");
                    String title = sc.nextLine().trim();
                    System.out.print("지은이: ");
                    books.add(new Book(title, sc.nextLine().trim()));
                    System.out.println("넣었어요.");
                    break;
                case "3":
                case "4":
                    System.out.print("번호: ");
                    int no = Integer.parseInt(sc.nextLine().trim());
                    if (no < 0 || no >= books.size()) {
                        System.out.println("그런 번호는 없어요.");
                        break;
                    }
                    books.get(no).borrowed = menu.equals("3");
                    System.out.println(books.get(no));
                    break;
                default:
                    System.out.println("0부터 4 사이에서 골라 주세요.");
            }
        }
    }

    static class Book {
        String title;
        String author;
        boolean borrowed;

        Book(String title, String author) {
            this.title = title;
            this.author = author;
        }

        @Override
        public String toString() {
            return title + " / " + author + (borrowed ? " [대출중]" : " [있음]");
        }
    }
}
` },
  { cat:"응용·도전", title:"람다와 스트림", name:"StreamBasics.java", level:4, pair:"lambda",
    desc:"filter·map·collect 로 목록을 한 줄에 걸러 바꿔요.", learn:["람다","Stream","filter/map/collect"], code:
`import java.util.List;
import java.util.stream.Collectors;

public class StreamBasics {
    public static void main(String[] args) {
        List<String> names = List.of("홍길동", "김철수", "이영희", "박민수", "김영수");

        List<String> kims = names.stream()
            .filter(n -> n.startsWith("김"))
            .collect(Collectors.toList());
        System.out.println("김씨: " + kims);

        List<Integer> numbers = List.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
        List<Integer> squares = numbers.stream()
            .filter(n -> n % 2 == 0)         // 짝수만 걸러서
            .map(n -> n * n)                 // 제곱으로 바꾸고
            .collect(Collectors.toList());   // 다시 목록으로
        System.out.println("짝수의 제곱: " + squares);

        System.out.println("합계: " + numbers.stream().mapToInt(Integer::intValue).sum());
        System.out.println("가장 긴 이름: " + names.stream()
            .max((a, b) -> a.length() - b.length()).orElse("없음"));
    }
}
` },
  { cat:"응용·도전", title:"배낭 문제 (DP)", name:"Knapsack.java", level:4, pair:"knapsack",
    desc:"2차원 DP 표를 채워 담을 물건을 고르고 역추적해요.", learn:["동적계획법","2차원 배열","역추적"], code:
`public class Knapsack {
    public static void main(String[] args) {
        String[] names = { "책", "노트북", "물병", "카메라" };
        int[] weight = { 1, 3, 4, 5 };
        int[] value = { 15, 40, 30, 50 };
        int limit = 8;

        int n = names.length;
        int[][] dp = new int[n + 1][limit + 1];

        for (int i = 1; i <= n; i++) {
            for (int w = 0; w <= limit; w++) {
                dp[i][w] = dp[i - 1][w];                       // 안 담았을 때의 값
                if (weight[i - 1] <= w) {                      // 담을 수 있으면 담아 보고 비교
                    int taken = dp[i - 1][w - weight[i - 1]] + value[i - 1];
                    if (taken > dp[i][w]) dp[i][w] = taken;
                }
            }
        }
        System.out.println("담을 수 있는 최대 가치: " + dp[n][limit]);

        int w = limit;
        for (int i = n; i > 0; i--) {                          // 값이 달라진 칸이 담은 물건이다
            if (dp[i][w] != dp[i - 1][w]) {
                System.out.println("담음: " + names[i - 1]
                    + " (무게 " + weight[i - 1] + ", 가치 " + value[i - 1] + ")");
                w -= weight[i - 1];
            }
        }
    }
}
` },
  { cat:"응용·도전", title:"N-퀸 퍼즐", name:"NQueens.java", level:5, pair:"nqueens",
    desc:"백트래킹과 가지치기로 모든 해를 세요.", learn:["백트래킹","재귀","가지치기"], code:
`public class NQueens {
    static int n = 8;
    static int[] col;      // col[r] = r번째 줄에 놓은 퀸의 칸 번호
    static int count = 0;

    public static void main(String[] args) {
        col = new int[n];
        solve(0);
        System.out.println(n + "-퀸의 해는 모두 " + count + "가지예요.");
    }

    static void solve(int row) {
        if (row == n) {
            count++;
            if (count == 1) print();       // 첫 번째 해만 그려 본다
            return;
        }
        for (int c = 0; c < n; c++) {
            if (!safe(row, c)) continue;   // 가지치기: 될 수 없는 자리는 아예 들어가지 않는다
            col[row] = c;
            solve(row + 1);
        }
    }

    static boolean safe(int row, int c) {
        for (int r = 0; r < row; r++) {
            if (col[r] == c) return false;                        // 같은 세로줄
            if (Math.abs(col[r] - c) == row - r) return false;    // 대각선
        }
        return true;
    }

    static void print() {
        for (int r = 0; r < n; r++) {
            StringBuilder sb = new StringBuilder();
            for (int c = 0; c < n; c++) sb.append(col[r] == c ? "Q " : ". ");
            System.out.println(sb.toString());
        }
    }
}
` },
  { cat:"응용·도전", title:"생명 게임", name:"GameOfLife.java", level:5, pair:"life",
    desc:"2차원 배열의 이웃 수로 세대를 넘겨 가며 규칙을 봐요.", learn:["셀룰러 오토마타","2차원 배열","이웃 세기"], code:
`public class GameOfLife {
    public static void main(String[] args) {
        int[][] world = new int[8][8];
        // 글라이더 하나를 놓고 시작한다
        world[1][2] = 1;
        world[2][3] = 1;
        world[3][1] = 1;
        world[3][2] = 1;
        world[3][3] = 1;

        for (int gen = 0; gen <= 4; gen++) {
            System.out.println("--- " + gen + "세대 ---");
            print(world);
            world = next(world);
        }
    }

    static int[][] next(int[][] world) {
        int rows = world.length, cols = world[0].length;
        int[][] out = new int[rows][cols];
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                int live = neighbors(world, r, c);
                // 살아 있으면 이웃이 2~3일 때 살아남고, 죽어 있으면 정확히 3일 때 태어난다
                if (world[r][c] == 1) out[r][c] = (live == 2 || live == 3) ? 1 : 0;
                else out[r][c] = (live == 3) ? 1 : 0;
            }
        }
        return out;
    }

    static int neighbors(int[][] world, int r, int c) {
        int count = 0;
        for (int dr = -1; dr <= 1; dr++) {
            for (int dc = -1; dc <= 1; dc++) {
                if (dr == 0 && dc == 0) continue;      // 자기 자신은 세지 않는다
                int nr = r + dr, nc = c + dc;
                if (nr < 0 || nc < 0 || nr >= world.length || nc >= world[0].length) continue;
                count += world[nr][nc];
            }
        }
        return count;
    }

    static void print(int[][] world) {
        for (int[] row : world) {
            StringBuilder sb = new StringBuilder();
            for (int cell : row) sb.append(cell == 1 ? "■ " : "· ");
            System.out.println(sb.toString());
        }
    }
}
` },
];
