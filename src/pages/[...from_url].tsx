import mongoClient from "@/db/connect";
import UrlModel, { URL_DATA_INTERFACE } from "@/db/models/url-model";
import { HydratedDocument } from "mongoose";
import { GetServerSidePropsContext, NextApiRequest } from "next";
import dayjs from "dayjs";
import styled from "styled-components";
import { ChangeEvent, useEffect, useState } from "react";
import { FormItemWrapper } from "@/components/creation-form";
import Input from "@/components/input";
import Button from "@/components/button";
import {
  Key,
  Visibility,
  VisibilityOff,
  ArrowRightAlt,
  Lock as LockIcon,
  LockClock,
  RepeatOn as RepeatOnIcon,
} from "@mui/icons-material";
import getUser from "@/db/get-user";
import { getRetryObject, isAllowable } from "@/utils/retries";

type RedirectToPropsType = {
  id: string;
  error?: boolean;
  message?: string;
  cools_at?: number;
  retries_left?: number;
};

export default function RedirectTo(props: RedirectToPropsType) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [leftTime, setLeftTime] = useState(() => {
    if (props.cools_at) {
      return props.cools_at - dayjs().unix();
    }
    return 0;
  });

  console.log(props);

  const changeHandler = (ev: ChangeEvent<HTMLInputElement>) => {
    setPassword(ev.target.value);
  };

  useEffect(() => {
    // cooldown timer countdown
    let i = leftTime;
    if (leftTime) {
      const leftTimeTimeout = setInterval(() => {
        if (i >= 0) {
          i--;
          setLeftTime(i);
          console.log(i);
        } else {
          clearInterval(i);
          setLeftTime(0);
        }
      }, 1000);
    }
  }, []);

  return (
    <StyledRedirectTo>
      <StyledForm method="POST" action={"/api/redirect/" + props.id} disabled={leftTime > 0}>
      <h2>
        <LockIcon /> Locked
      </h2>
        <StyledInfoContainer>
          {props.retries_left && (
            <div title={"You will be locked after " + props.retries_left + " failed attempts"}>
              <p>
                <RepeatOnIcon /> {props.retries_left}/3 left{" "}
              </p>
            </div>
          )}

          {leftTime > 0 && (
            <div title={"You will be able to retry after " + leftTime + " seconds..."}>
              <LockClock />
              <p>{leftTime}s</p>
            </div>
          )}
        </StyledInfoContainer>

        <FormItemWrapper>
          <Input
            disabled={leftTime > 0}
            id="password"
            value={password || ""}
            name="password"
            placeholder=" "
            title="Enter password to use the URL"
            required={false}
            type={passwordVisible ? "text" : "password"}
            style={{ paddingRight: "2rem" }}
            onChange={changeHandler}
            autoComplete="new-password"
          />
          <span>
            {" "}
            <Key />{" "}
          </span>
          <PasswordButtonsContainer>
            {/* VISIBILITY */}
            <Button
              type="button"
              onClick={() => {
                setPasswordVisible((visible) => !visible);
              }}
            >
              {passwordVisible ? <Visibility /> : <VisibilityOff />}
            </Button>

            {/* POST */}
            <Button active={!(leftTime > 0)}>
              <ArrowRightAlt />
            </Button>
          </PasswordButtonsContainer>
          <label className="label" htmlFor="password">
            {" "}
            Enter Password{" "}
          </label>
        </FormItemWrapper>
        <FormItemWrapper>
          <label>
            {" "}
            Remember me
            <input
              type={"checkbox"}
              name="remember"
              disabled={leftTime > 0}
              title="If enabled, you don't have to type the password next time."
            />
          </label>
        </FormItemWrapper>

      </StyledForm>
    </StyledRedirectTo>
  );
}

const StyledForm = styled.form<{disabled?: Boolean}>`
  background-color: rgba(28, 0, 33, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--padding-big);
  & input {
    border-radius: var(--padding-big);
  box-shadow: ${ ({theme}) => theme.shadow.secondary };
  };
  box-shadow: ${ ({theme}) => theme.shadow.primary };
  padding: var(--padding-big);
  border-radius: var(--padding-big);
  ${ ({disabled}) => disabled ? "border: 0.15rem solid rgba(160, 0, 0, 1)" : ""}
`

const StyledInfoContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-around;
  width: 80%;
`;

const PasswordButtonsContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--padding-normal);
`;

const StyledRedirectTo = styled.section`
  color: white;
  padding-top: 5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  justify-content: flex-start;
`;

export async function getServerSideProps(context: GetServerSidePropsContext) {
  let dest_id = context.query.from_url;

  if (!dest_id || (typeof dest_id == "object" && dest_id.length > 1)) {
    console.log("1>>>");

    return {
      notFound: true,
    };
  }

  dest_id = dest_id[0];

  if (dest_id) {
    await mongoClient();
    const doc = await UrlModel.findOne<HydratedDocument<URL_DATA_INTERFACE>>({
      urlid: dest_id,
    }).exec();

    const now = dayjs().unix();

    if (
      !doc ||
      (doc.timeout && now >= doc.timeout) ||
      (doc.limit && doc.clicks >= doc.limit)
    ) {
      return {
        notFound: true,
      };
    }

    // if url is password protected return password form;
    if (doc.password) {
      const user = await getUser(context.req as NextApiRequest); // we only need cookies so I did req as NextApiRequest, Not recommended way;
      // check if user ever accessed url with remember me option turned on;
      if (!user) {
        return {
          props: { id: doc.urlid },
        };
      }

      if (user.has_access_to && user.has_access_to.includes(dest_id)) {
        return {
          redirect: {
            destination: doc.to_url,
            permanent: false,
          },
        };
      }

      const retryObject = getRetryObject(user, doc.urlid);
      console.log("RETRY OBJECT: ", retryObject);

      if (!retryObject) {
        return {
          props: {
            id: doc.urlid,
          },
        };
      }

      return {
        props: {
          id: doc.urlid,
          cools_at: retryObject.cools_at || null,
          retries_left: retryObject.max_retry_count - retryObject.count,
        },
      };
    }

    doc.clicks = doc.clicks + 1;
    await doc.save();
    console.log(doc);
    return {
      redirect: {
        destination: doc.to_url,
        permanent: false,
      },
    };
  }

  return {
    notFound: true,
  };
}
