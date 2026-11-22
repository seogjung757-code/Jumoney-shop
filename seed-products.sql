-- 주머니중고폰 초기 판매상품 등록
-- 기준 시세(기존 대화에서 사용한 2026-11-21 TTM 참고표): S23 428,000 / S22 311,000 / iPhone 14 561,000 / iPhone 15 764,000
-- 판매가는 기준 시세에 5,000~20,000원을 더한 값으로 책정. 재고는 요청에 따라 옵션별 초기 판매수량으로 배정.
-- 이 SQL은 중복 실행해도 동일 ID 상품을 중복 생성하지 않음.
INSERT OR IGNORE INTO products
(id,name,brand,model,capacity,condition_label,description,image_url,price,stock,active)
VALUES
('jm-galaxy-s23-128-a','갤럭시 S23 128GB A급','Samsung','Galaxy S23','128GB','A급 기준','중고 단말기 모델 참고 사진입니다. 실제 발송 기기의 색상·외관·배터리 성능·구성품은 주문 전 상세 확인이 필요합니다.','https://image-us.samsung.com/us/smartphones/galaxy-s23/configurator/D1_D2-Group-KV-Configurator-DT-800x600.jpg',441000,27,1),
('jm-galaxy-s22-128-a','갤럭시 S22 128GB A급','Samsung','Galaxy S22','128GB','A급 기준','중고 단말기 모델 참고 사진입니다. 실제 발송 기기의 색상·외관·배터리 성능·구성품은 주문 전 상세 확인이 필요합니다.','https://cdn.mos.cms.futurecdn.net/794j5wFezQq2D9Ykb5JWkT.jpg',322000,18,1),
('jm-iphone-14-128-a','아이폰 14 128GB A급','Apple','iPhone 14','128GB','A급 기준','중고 단말기 모델 참고 사진입니다. 실제 발송 기기의 색상·외관·배터리 성능·구성품은 주문 전 상세 확인이 필요합니다.','https://cdn.mos.cms.futurecdn.net/794j5wFezQq2D9Ykb5JWkT.jpg',576000,36,1),
('jm-iphone-15-128-a','아이폰 15 128GB A급','Apple','iPhone 15','128GB','A급 기준','중고 단말기 모델 참고 사진입니다. 실제 발송 기기의 색상·외관·배터리 성능·구성품은 주문 전 상세 확인이 필요합니다.','https://static.android.com.pl/uploads/2023/09/samsung_galaxy_s23_vs_iphone_15-transformed.jpeg',779000,44,1);
